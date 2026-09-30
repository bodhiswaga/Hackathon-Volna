import { analyze, LOW_BUFFER_DAYS } from './analyze';
import { daysText, formatShort, indexToDate, startIndex } from './calendar';
import { applyChangeSet } from './changeset';
import type {
  AdviseOptions,
  Advice,
  Analysis,
  ChangeOp,
  ISODate,
  Person,
  ProjectState,
  RecoveryPlan,
  Suggestion,
  Task,
} from './types';

/** Максимальная доля длительности, которую советник предлагает «ужать». */
export const MAX_CRASH_SHARE = 0.3;
/** Максимальный нахлёст задач при распараллеливании — доля длительности предшественника. */
export const MAX_OVERLAP_SHARE = 0.5;
/** Какую часть оставшейся работы можно отдать помощнику: больше — растут потери на передачу. */
export const MAX_SPLIT_SHARE = 0.4;
/** Сколько вариантов одного вида показывать: остальные почти не отличаются. */
const PER_KIND = 2;

interface Ctx {
  state: ProjectState;
  analysis: Analysis;
  today: ISODate;
  drivers: Map<string, number>;
  newId: () => string;
  /** Какой запас нужен плану: 0 — вернуться в дедлайн, LOW_BUFFER_DAYS — с запасом. */
  target: number;
}

type Draft = Omit<
  Suggestion,
  'gainDays' | 'finishAfter' | 'bufferAfter' | 'fitsDeadline' | 'resolves' | 'sideEffects'
>;

function evaluate(ctx: Ctx, base: Draft): Suggestion | null {
  let next: ProjectState;
  try {
    next = applyChangeSet(ctx.state, base.ops);
  } catch {
    return null;
  }
  const a = analyze(next, ctx.today);
  const before = new Set(ctx.analysis.alerts.map((x) => x.key));
  const after = new Set(a.alerts.map((x) => x.key));
  return {
    ...base,
    gainDays: ctx.analysis.finishIndex - a.finishIndex,
    finishAfter: a.finishDate,
    bufferAfter: a.bufferDays,
    fitsDeadline: a.bufferDays >= 0,
    resolves: ctx.analysis.alerts.filter((x) => !after.has(x.key)).map((x) => x.text),
    // Побочные эффекты: проблемы, которых до решения не было (перегрузка, срыв срока задачи…).
    sideEffects: a.alerts
      .filter((x) => !before.has(x.key) && x.code !== 'low_buffer')
      .map((x) => x.text),
  };
}

/** Почему именно эта задача: доля прогонов, где она решала срок, иначе — нулевой резерв. */
function whyTask(ctx: Ctx, t: Task): string {
  const share = ctx.drivers.get(t.id);
  if (share !== undefined && share >= 0.2) {
    return `«${t.name}» определяет финиш в ${Math.round(share * 100)}% прогонов прогноза`;
  }
  return `«${t.name}» на критическом пути: резерва нет, каждый день задержки сдвигает финиш`;
}

/**
 * Перебирает силу действия 1..max: берёт минимальную, которая закрывает отставание,
 * иначе — минимальную с максимальным выигрышем (лишние дни не «сжигаем»).
 */
function bestOf(ctx: Ctx, max: number, build: (k: number) => Draft | null): Suggestion | null {
  const deficit = Math.max(0, ctx.target - ctx.analysis.bufferDays);
  let best: Suggestion | null = null;
  for (let k = 1; k <= max; k++) {
    const draft = build(k);
    const s = draft && evaluate(ctx, draft);
    if (!s || s.gainDays <= 0) continue;
    if (deficit > 0 && s.gainDays >= deficit) return s;
    if (!best || s.gainDays > best.gainDays) best = s;
  }
  return best;
}

/** Слова роли для сравнения: «Mobile-разработчик» → mobile, разработчик. */
const roleWords = (role: string) =>
  new Set(
    role
      .toLowerCase()
      .split(/[^a-zа-яё]+/i)
      .filter((w) => w.length >= 4),
  );

const isContractor = (p: Person) => /подрядчик/i.test(p.role);

/** Незавершённые задачи человека (кроме исключённой) как полуинтервалы рабочих дней. */
function busyOf(ctx: Ctx, personId: string, except: string): [number, number][] {
  return ctx.state.tasks
    .filter(
      (o) =>
        o.assigneeId === personId && o.id !== except && o.status !== 'done' && o.durationDays > 0,
    )
    .map((o) => [ctx.analysis.tasks[o.id]!.es, ctx.analysis.tasks[o.id]!.ef]);
}

/** Самый ранний старт ≥ from, при котором окно [start, start+k) у человека свободно. */
function freeSlot(busy: [number, number][], from: number, k: number, until: number): number | null {
  let start = from;
  for (let guard = 0; guard < 200 && start + k <= until; guard++) {
    const hit = busy.find(([s, e]) => s < start + k && start < e);
    if (!hit) return start;
    start = hit[1];
  }
  return null;
}

/**
 * Разделить критическую задачу: часть работы берёт свободный человек подходящей роли.
 * Новая задача идёт параллельно — ждёт тех же предшественников, последующие ждут обе части.
 */
function splitCandidates(ctx: Ctx, exclude: Set<string>): Suggestion[] {
  const { state, analysis } = ctx;
  const todayIdx = startIndex(analysis.today);
  const maxOrder = Math.max(0, ...state.tasks.map((x) => x.sortOrder));
  const out: Suggestion[] = [];
  for (const id of analysis.criticalPath) {
    const t = state.tasks.find((x) => x.id === id)!;
    if (t.status === 'done' || t.status === 'blocked' || t.durationDays < 3) continue;
    const s = analysis.tasks[id]!;
    const from = Math.max(s.es, todayIdx);
    const remaining = s.ef - from;
    const maxK = Math.floor(remaining * MAX_SPLIT_SHARE);
    if (maxK < 1) continue;
    const owner = state.people.find((p) => p.id === t.assigneeId);
    const ownerWords = owner ? roleWords(owner.role) : new Set<string>();
    // Помощник — не исполнитель и не подрядчик, с похожей ролью: QA не возьмёт часть бэкенда.
    // Если исполнителя нет, подходит любой.
    const helpers = state.people
      .filter((p) => p.id !== t.assigneeId && !isContractor(p))
      .map((p) => ({ p, match: [...roleWords(p.role)].some((w) => ownerWords.has(w)) }))
      .filter((h) => h.match || !owner)
      .sort((x, y) => Number(y.match) - Number(x.match));

    let best: Suggestion | null = null;
    for (const { p } of helpers) {
      const key = `split:${id}:${p.id}`;
      if (exclude.has(key)) continue;
      const busy = busyOf(ctx, p.id, id);
      const sug = bestOf(ctx, maxK, (k) => {
        const slot = freeSlot(busy, from, k, s.ef);
        if (slot === null) return null;
        const partId = ctx.newId();
        const preds = state.dependencies.filter((d) => d.successorId === id);
        const succs = state.dependencies.filter((d) => d.predecessorId === id);
        const ops: ChangeOp[] = [
          { type: 'updateTask', taskId: id, patch: { durationDays: t.durationDays - k } },
          {
            type: 'createTask',
            task: {
              id: partId,
              projectId: state.project.id,
              name: `${t.name} — часть (${p.name.split(' ')[0]})`,
              description: `Выделено из «${t.name}» по совету советника`,
              durationDays: k,
              status: 'not_started',
              assigneeId: p.id,
              dueDate: null,
              startNotEarlier: slot > todayIdx ? indexToDate(slot) : null,
              actualStart: null,
              actualEnd: null,
              sortOrder: maxOrder + 1,
            },
          },
          ...preds.map((d): ChangeOp => ({
            type: 'addDependency',
            dependency: {
              id: ctx.newId(),
              projectId: state.project.id,
              predecessorId: d.predecessorId,
              successorId: partId,
              // Часть работы ждёт то же, что и исходная задача, — с той же паузой.
              lagDays: Math.max(0, d.lagDays),
            },
          })),
          ...succs.map((d): ChangeOp => ({
            type: 'addDependency',
            dependency: {
              id: ctx.newId(),
              projectId: state.project.id,
              predecessorId: partId,
              successorId: d.successorId,
              lagDays: Math.max(0, d.lagDays),
            },
          })),
        ];
        return {
          id: key,
          kind: 'split',
          title: `${p.name} берёт часть «${t.name}» — ${daysText(k)}`,
          description: `${p.name} (${p.role}): свободное окно с ${formatShort(indexToDate(slot))}. Выделить ${daysText(k)} из ${daysText(remaining)} оставшейся работы в параллельную задачу — последующие задачи ждут обе части`,
          why: whyTask(ctx, t),
          costText: `${daysText(k)} работы помощника, без переработок`,
          ops,
          cost: k <= 3 ? 1 : 2,
        };
      });
      if (sug && (!best || sug.gainDays > best.gainDays)) best = sug;
    }
    if (best) out.push(best);
  }
  return out;
}

/** Кандидаты, которые ускоряют проект (без переноса дедлайна и переназначений). */
function accelerationCandidates(ctx: Ctx, exclude: Set<string>): Suggestion[] {
  const { state, analysis } = ctx;
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const out: Suggestion[] = [];

  for (const id of analysis.criticalPath) {
    const t = byId.get(id)!;
    const key = `crash:${id}`;
    // Готовую или вставшую задачу «ускорить» нельзя — это не совет, а пожелание.
    if (exclude.has(key) || t.status === 'done' || t.status === 'blocked') continue;
    const s = bestOf(ctx, Math.floor(t.durationDays * MAX_CRASH_SHARE), (cut) => ({
      id: key,
      kind: 'crash',
      title: `Ускорить «${t.name}» на ${daysText(cut)}`,
      description: `Переработки исполнителя или урезать объём: ${t.durationDays} → ${daysText(t.durationDays - cut)}`,
      why: whyTask(ctx, t),
      costText: `${daysText(cut)} переработки или урезанный объём`,
      ops: [{ type: 'updateTask', taskId: id, patch: { durationDays: t.durationDays - cut } }],
      cost: cut >= 3 ? 3 : 2,
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
        why: `Пауза стоит на критическом пути и сдвигает финиш целиком`,
        costText: 'договорённость, без затрат',
        ops: [{ type: 'updateDependency', dependencyId: d.id, lagDays: 0 }],
        cost: 1,
      });
      if (s && s.gainDays > 0) out.push(s);
    }
    // Fast-tracking: последователь стартует до окончания предшественника (нахлёст ≤ половины).
    const key = `par:${d.id}`;
    if (exclude.has(key) || d.lagDays > 0) continue;
    const s = bestOf(ctx, Math.floor(pred.durationDays * MAX_OVERLAP_SHARE), (k) => ({
      id: key,
      kind: 'parallelize',
      title: `Начать «${succ.name}» на ${daysText(k)} раньше`,
      description: `Начать, не дожидаясь полного окончания «${pred.name}»: задачи идут внахлёст ${daysText(k)}`,
      why: `Обе задачи на критическом пути и идут строго друг за другом`,
      costText: 'риск переделок: работа идёт по неготовому результату',
      ops: [{ type: 'updateDependency', dependencyId: d.id, lagDays: -k }],
      cost: k >= 3 ? 3 : 2,
    }));
    if (s) out.push(s);
  }

  for (const id of analysis.criticalPath) {
    const t = byId.get(id)!;
    if (!t.startNotEarlier || analysis.tasks[id]!.driver.kind !== 'constraint') continue;
    if (exclude.has(`cons:${id}`)) continue;
    const s = evaluate(ctx, {
      id: `cons:${id}`,
      kind: 'removeConstraint',
      title: `Договориться о более раннем старте «${t.name}»`,
      description: `Сейчас задача ждёт до ${formatShort(t.startNotEarlier)} — снять ограничение`,
      why: `Старт задачи держит ограничение «не раньше», а не предыдущие задачи`,
      costText: 'переговоры со смежником',
      ops: [{ type: 'updateTask', taskId: id, patch: { startNotEarlier: null } }],
      cost: 2,
    });
    if (s && s.gainDays > 0) out.push(s);
  }
  return [...out, ...splitCandidates(ctx, exclude)];
}

function reassignCandidates(ctx: Ctx): Suggestion[] {
  const { state, analysis } = ctx;
  const out: Suggestion[] = [];
  for (const id of analysis.order) {
    const s = analysis.tasks[id]!;
    const t = state.tasks.find((x) => x.id === id)!;
    if (!s.flags.overloaded || t.status !== 'not_started') continue;
    const from = state.people.find((p) => p.id === t.assigneeId);
    const fromWords = from ? roleWords(from.role) : new Set<string>();
    // Свободный человек без пересечений; сначала — с похожей ролью.
    const free = state.people
      .filter(
        (p) =>
          p.id !== t.assigneeId &&
          !isContractor(p) &&
          !busyOf(ctx, p.id, id).some(([es, ef]) => es < s.ef && s.es < ef),
      )
      .sort(
        (x, y) =>
          Number([...roleWords(y.role)].some((w) => fromWords.has(w))) -
          Number([...roleWords(x.role)].some((w) => fromWords.has(w))),
      )[0];
    if (!free) continue;
    const sug = evaluate(ctx, {
      id: `reassign:${id}:${free.id}`,
      kind: 'reassign',
      title: `Передать «${t.name}» → ${free.name}`,
      description: `У ${from?.name ?? 'исполнителя'} задачи пересекаются по времени, у ${free.name} (${free.role}) в эти дни свободное окно`,
      why: `Перегрузка: один человек не сделает две задачи одновременно, план нереалистичен`,
      costText: 'без доп. затрат, нужна передача контекста',
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
  // Решение без побочных проблем лучше равного по выигрышу, но создающего новые.
  if (a.sideEffects.length !== b.sideEffects.length) {
    return a.sideEffects.length - b.sideEffects.length;
  }
  return a.cost - b.cost;
}

/**
 * Когда сроки в порядке, запас укрепляют без риска: сначала то, что снимает текущие проблемы,
 * затем дешёвое и без побочных эффектов, и только потом — сильное.
 */
function rankCalm(a: Suggestion, b: Suggestion): number {
  const fixes = Number(b.resolves.length > 0) - Number(a.resolves.length > 0);
  if (fixes !== 0) return fixes;
  if (a.sideEffects.length !== b.sideEffects.length) {
    return a.sideEffects.length - b.sideEffects.length;
  }
  if (a.cost !== b.cost) return a.cost - b.cost;
  return b.gainDays - a.gainDays;
}

/** Не больше PER_KIND вариантов одного вида: десяток «ускорить на день» ничего не добавляет. */
function limitPerKind(list: Suggestion[]): Suggestion[] {
  const seen = new Map<string, number>();
  return list.filter((s) => {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    return n < PER_KIND;
  });
}

/**
 * Жадный план до нужного запаса: на каждом шаге — самый дешёвый шаг, закрывающий нехватку,
 * без новых проблем; иначе — самый сильный.
 */
function buildPlan(ctx: Ctx, target: number): RecoveryPlan | null {
  if (ctx.analysis.bufferDays >= target) return null;
  let cur: Ctx = { ...ctx, target };
  const steps: Suggestion[] = [];
  const ops: ChangeOp[] = [];
  const used = new Set<string>();

  for (let i = 0; i < 5 && cur.analysis.bufferDays < target; i++) {
    // Переназначение тоже годится, если снимает перегрузку и этим сдвигает финиш.
    const cands = [
      ...accelerationCandidates(cur, used),
      ...reassignCandidates(cur).filter((c) => c.gainDays > 0 && !used.has(c.id)),
    ];
    if (cands.length === 0) break;
    const need = target - cur.analysis.bufferDays;
    const closing = cands
      .filter((c) => c.gainDays >= need)
      .sort(
        (a, b) =>
          a.sideEffects.length - b.sideEffects.length || a.cost - b.cost || b.gainDays - a.gainDays,
      );
    const pick =
      closing[0] ??
      [...cands].sort(
        (a, b) =>
          b.gainDays - a.gainDays || a.sideEffects.length - b.sideEffects.length || a.cost - b.cost,
      )[0]!;
    used.add(pick.id);
    steps.push(pick);
    ops.push(...pick.ops);
    const nextState = applyChangeSet(cur.state, pick.ops);
    cur = { ...cur, state: nextState, analysis: analyze(nextState, ctx.today) };
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

/** Id по умолчанию — счётчик на один вызов: одинаковый вход даёт одинаковые варианты. */
function counterIds(): () => string {
  let n = 0;
  return () => `advice-${++n}`;
}

/** Советник: варианты действий с просчитанным эффектом и планы восстановления сроков. */
export function advise(state: ProjectState, today: ISODate, options: AdviseOptions = {}): Advice {
  const analysis = analyze(state, today);
  const ctx: Ctx = {
    state,
    analysis,
    today,
    drivers: new Map((options.drivers ?? []).map((d) => [d.taskId, d.share])),
    newId: options.newId ?? counterIds(),
    target: 0,
  };

  const suggestions = limitPerKind(
    [...accelerationCandidates(ctx, new Set()), ...reassignCandidates(ctx)].sort(
      analysis.bufferDays >= 0 ? rankCalm : rank,
    ),
  );

  if (analysis.bufferDays < 0) {
    const newDeadline = indexToDate(analysis.finishIndex - 1);
    const s = evaluate(ctx, {
      id: 'deadline',
      kind: 'moveDeadline',
      title: `Согласовать перенос дедлайна на ${formatShort(newDeadline)}`,
      description: `Честный вариант, если ускорение невозможно: +${daysText(-analysis.bufferDays)} к сроку`,
      why: `Ускорение стоит денег и рисков; иногда дешевле договориться`,
      costText: 'переговоры с заказчиком',
      ops: [{ type: 'updateProject', patch: { deadline: newDeadline } }],
      cost: 3,
    });
    if (s) suggestions.push(s);
  }

  const plan = buildPlan(ctx, 0);
  const safe = buildPlan(ctx, LOW_BUFFER_DAYS);
  // «С запасом» показываем, только если он отличается от минимального плана.
  const safePlan =
    safe && (!plan || safe.bufferAfter > plan.bufferAfter) && safe.bufferAfter >= 0 ? safe : null;
  return { suggestions, plan, safePlan };
}
