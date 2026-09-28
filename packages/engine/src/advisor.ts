import { analyze } from './analyze';
import { daysText, formatShort, indexToDate } from './calendar';
import { applyChangeSet } from './changeset';
import type {
  Advice,
  Analysis,
  ChangeOp,
  ISODate,
  ProjectState,
  RecoveryPlan,
  Suggestion,
} from './types';

/** Максимальная доля длительности, которую советник предлагает «ужать». */
export const MAX_CRASH_SHARE = 0.3;
/** Максимальный нахлёст задач при распараллеливании — доля длительности предшественника. */
export const MAX_OVERLAP_SHARE = 0.5;

interface Ctx {
  state: ProjectState;
  analysis: Analysis;
  today: ISODate;
}

function evaluate(
  ctx: Ctx,
  base: Omit<Suggestion, 'gainDays' | 'finishAfter' | 'bufferAfter' | 'fitsDeadline' | 'resolves'>,
): Suggestion | null {
  let next: ProjectState;
  try {
    next = applyChangeSet(ctx.state, base.ops);
  } catch {
    return null;
  }
  const a = analyze(next, ctx.today);
  const afterKeys = new Set(a.alerts.map((x) => x.key));
  return {
    ...base,
    gainDays: ctx.analysis.finishIndex - a.finishIndex,
    finishAfter: a.finishDate,
    bufferAfter: a.bufferDays,
    fitsDeadline: a.bufferDays >= 0,
    resolves: ctx.analysis.alerts.filter((x) => !afterKeys.has(x.key)).map((x) => x.text),
  };
}

/** Кандидаты, которые ускоряют проект (без переноса дедлайна и переназначений). */
function accelerationCandidates(ctx: Ctx, exclude: Set<string>): Suggestion[] {
  const { state, analysis } = ctx;
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const out: Suggestion[] = [];
  const deficit = Math.max(0, -analysis.bufferDays);

  /**
   * Перебирает силу действия 1..max: берёт минимальную, которая закрывает отставание,
   * иначе — минимальную с максимальным выигрышем (лишние дни не «сжигаем»).
   */
  const bestOf = (
    max: number,
    build: (k: number) => Parameters<typeof evaluate>[1],
  ): Suggestion | null => {
    let best: Suggestion | null = null;
    for (let k = 1; k <= max; k++) {
      const s = evaluate(ctx, build(k));
      if (!s || s.gainDays <= 0) continue;
      if (deficit > 0 && s.gainDays >= deficit) return s;
      if (!best || s.gainDays > best.gainDays) best = s;
    }
    return best;
  };

  for (const id of analysis.criticalPath) {
    const t = byId.get(id)!;
    const key = `crash:${id}`;
    if (exclude.has(key)) continue;
    const s = bestOf(Math.floor(t.durationDays * MAX_CRASH_SHARE), (cut) => ({
      id: key,
      kind: 'crash',
      title: `Ускорить «${t.name}» на ${daysText(cut)}`,
      description: `Добавить исполнителя или сократить объём: ${t.durationDays} → ${daysText(t.durationDays - cut)}`,
      ops: [{ type: 'updateTask', taskId: id, patch: { durationDays: t.durationDays - cut } }],
      cost: 2,
    }));
    if (s) out.push(s);
  }

  const critDeps = new Set(analysis.criticalDependencyIds);
  for (const d of state.dependencies) {
    if (!critDeps.has(d.id)) continue;
    const pred = byId.get(d.predecessorId)!;
    const succ = byId.get(d.successorId)!;
    if (pred.status === 'done' || succ.status !== 'not_started') continue;

    if (d.lagDays > 0 && !exclude.has(`lag:${d.id}`)) {
      const s = evaluate(ctx, {
        id: `lag:${d.id}`,
        kind: 'removeLag',
        title: `Убрать ожидание между «${pred.name}» и «${succ.name}»`,
        description: `Сейчас между задачами пауза ${daysText(d.lagDays)} — договориться начать сразу`,
        ops: [{ type: 'updateDependency', dependencyId: d.id, lagDays: 0 }],
        cost: 1,
      });
      if (s && s.gainDays > 0) out.push(s);
    }
    // Fast-tracking: последователь стартует до окончания предшественника (нахлёст ≤ половины).
    const key = `par:${d.id}`;
    if (exclude.has(key) || d.lagDays > 0) continue;
    const s = bestOf(Math.floor(pred.durationDays * MAX_OVERLAP_SHARE), (k) => ({
      id: key,
      kind: 'parallelize',
      title: `Начать «${succ.name}» на ${daysText(k)} раньше`,
      description: `Старт до полного окончания предшествующей задачи «${pred.name}» (нахлёст ${daysText(k)}). Риск доработок — нужна синхронизация команд`,
      ops: [{ type: 'updateDependency', dependencyId: d.id, lagDays: -k }],
      cost: 3,
    }));
    if (s) out.push(s);
  }

  for (const id of analysis.criticalPath) {
    const t = byId.get(id)!;
    if (!t.startNotEarlier || analysis.tasks[id].driver.kind !== 'constraint') continue;
    if (exclude.has(`cons:${id}`)) continue;
    const s = evaluate(ctx, {
      id: `cons:${id}`,
      kind: 'removeConstraint',
      title: `Договориться о более раннем старте «${t.name}»`,
      description: `Сейчас задача ждёт до ${formatShort(t.startNotEarlier)} — снять ограничение`,
      ops: [{ type: 'updateTask', taskId: id, patch: { startNotEarlier: null } }],
      cost: 2,
    });
    if (s && s.gainDays > 0) out.push(s);
  }
  return out;
}

function reassignCandidates(ctx: Ctx): Suggestion[] {
  const { state, analysis } = ctx;
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const id of analysis.order) {
    const s = analysis.tasks[id];
    const t = state.tasks.find((x) => x.id === id)!;
    if (!s.flags.overloaded || t.status !== 'not_started' || seen.has(id)) continue;
    seen.add(id);
    // Свободный человек: нет незавершённых задач, пересекающихся с окном задачи.
    const free = state.people.find(
      (p) =>
        p.id !== t.assigneeId &&
        !state.tasks.some(
          (o) =>
            o.assigneeId === p.id &&
            o.status !== 'done' &&
            o.durationDays > 0 &&
            analysis.tasks[o.id].es < s.ef &&
            s.es < analysis.tasks[o.id].ef,
        ),
    );
    if (!free) continue;
    const from = state.people.find((p) => p.id === t.assigneeId);
    const sug = evaluate(ctx, {
      id: `reassign:${id}:${free.id}`,
      kind: 'reassign',
      title: `Передать «${t.name}» → ${free.name}`,
      description: `${from?.name ?? 'Исполнитель'}: задачи пересекаются по времени. ${free.name}: в этот период свободное окно`,
      ops: [{ type: 'updateTask', taskId: id, patch: { assigneeId: free.id } }],
      cost: 1,
    });
    if (sug) out.push(sug);
  }
  return out;
}

function rank(a: Suggestion, b: Suggestion): number {
  if (a.fitsDeadline !== b.fitsDeadline) return a.fitsDeadline ? -1 : 1;
  if (a.gainDays !== b.gainDays) return b.gainDays - a.gainDays;
  return a.cost - b.cost;
}

/** Жадный план: на каждом шаге берём самый дешёвый шаг, закрывающий отставание, иначе — самый сильный. */
function buildPlan(ctx: Ctx): RecoveryPlan | null {
  if (ctx.analysis.bufferDays >= 0) return null;
  let cur: Ctx = ctx;
  const steps: Suggestion[] = [];
  const ops: ChangeOp[] = [];
  const used = new Set<string>();

  for (let i = 0; i < 5 && cur.analysis.bufferDays < 0; i++) {
    const cands = accelerationCandidates(cur, used);
    if (cands.length === 0) break;
    const deficit = -cur.analysis.bufferDays;
    const closing = cands
      .filter((c) => c.gainDays >= deficit)
      .sort((a, b) => a.cost - b.cost || b.gainDays - a.gainDays);
    const pick = closing[0] ?? cands.sort((a, b) => b.gainDays - a.gainDays || a.cost - b.cost)[0];
    used.add(pick.id);
    steps.push(pick);
    ops.push(...pick.ops);
    const nextState = applyChangeSet(cur.state, pick.ops);
    cur = { state: nextState, analysis: analyze(nextState, ctx.today), today: ctx.today };
  }
  if (steps.length === 0) return null;
  return {
    steps,
    ops,
    finishAfter: cur.analysis.finishDate,
    bufferAfter: cur.analysis.bufferDays,
    fitsDeadline: cur.analysis.bufferDays >= 0,
  };
}

/** Советник: варианты действий с просчитанным эффектом и план восстановления сроков. */
export function advise(state: ProjectState, today: ISODate): Advice {
  const analysis = analyze(state, today);
  const ctx: Ctx = { state, analysis, today };

  const suggestions = [...accelerationCandidates(ctx, new Set()), ...reassignCandidates(ctx)].sort(
    (a, b) =>
      // Когда сроки в порядке, важнее снять текущие проблемы (перегрузки), чем ускоряться.
      analysis.bufferDays >= 0 && a.resolves.length > 0 !== b.resolves.length > 0
        ? a.resolves.length > 0
          ? -1
          : 1
        : rank(a, b),
  );

  if (analysis.bufferDays < 0) {
    const newDeadline = indexToDate(analysis.finishIndex - 1);
    const s = evaluate(ctx, {
      id: 'deadline',
      kind: 'moveDeadline',
      title: `Согласовать перенос дедлайна на ${formatShort(newDeadline)}`,
      description: `Честный вариант, если ускорение невозможно: +${daysText(-analysis.bufferDays)} к сроку`,
      ops: [{ type: 'updateProject', patch: { deadline: newDeadline } }],
      cost: 3,
    });
    if (s) suggestions.push(s);
  }

  return { suggestions, plan: buildPlan(ctx) };
}
