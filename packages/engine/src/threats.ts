import { analyze } from './analyze';
import { daysText, formatShort, indexToDate } from './calendar';
import { applyChangeSet } from './changeset';
import { compileEvent } from './events';
import { isRiskyTask } from './forecast';
import type { Analysis, ISODate, ProjectEvent, ProjectState, TaskSchedule, Threat } from './types';

/** Типовые сбои шторм-теста. */
export const STRESS_HARDER_SHARE = 0.3;
export const STRESS_ABSENCE_DAYS = 5;
export const STRESS_DELAY_DAYS = 5;
const STRESS_PER_KIND = 2;

type Candidate = Pick<Threat, 'id' | 'kind' | 'title' | 'detail' | 'taskId' | 'ops' | 'reason'>;

/**
 * Шторм-тест: заранее проигрывает типовые сбои (задача сложнее, человек выпал, подрядчик
 * задержал старт) и ранжирует их по ущербу, посчитанному тем же движком.
 */
export function stressTest(
  state: ProjectState,
  analysis: Analysis,
  today: ISODate,
  limit = 6,
): Threat[] {
  const open = state.tasks.filter((t) => t.status !== 'done' && t.durationDays > 0);
  const candidates: Candidate[] = [];
  const add = (c: Omit<Candidate, 'ops' | 'reason'>, event: ProjectEvent) => {
    const { ops, title } = compileEvent(state, today, event, () => '');
    if (ops.length > 0) candidates.push({ ...c, ops, reason: title });
  };

  for (const t of open) {
    const s = analysis.tasks[t.id];
    const remaining = s.ef - Math.max(s.es, analysis.todayIndex);
    const extraDays = Math.max(1, Math.round(remaining * STRESS_HARDER_SHARE));
    add(
      {
        id: `harder:${t.id}`,
        kind: 'harder',
        title: `«${t.name}» окажется сложнее`,
        detail: `+${Math.round(STRESS_HARDER_SHARE * 100)}% к оставшейся работе, это ${extraDays} дн.`,
        taskId: t.id,
      },
      { kind: 'harder', taskId: t.id, extraDays },
    );
    if (t.status === 'not_started' && (t.startNotEarlier || isRiskyTask(t, state.people))) {
      const until = indexToDate(s.es + STRESS_DELAY_DAYS);
      add(
        {
          id: `delay:${t.id}`,
          kind: 'delay',
          title: `«${t.name}» начнётся на ${daysText(STRESS_DELAY_DAYS)} позже`,
          detail: `Подрядчик или смежник задержит старт до ${formatShort(until)}`,
          taskId: t.id,
        },
        { kind: 'delay', taskId: t.id, until },
      );
    }
  }

  for (const p of state.people) {
    const own = open.filter((t) => t.assigneeId === p.id);
    if (own.length === 0) continue;
    const start = Math.max(
      analysis.todayIndex,
      Math.min(...own.map((t) => analysis.tasks[t.id].es)),
    );
    const from = indexToDate(start);
    const to = indexToDate(start + STRESS_ABSENCE_DAYS - 1);
    add(
      {
        id: `absence:${p.id}`,
        kind: 'absence',
        title: `${p.name} выпадет на ${daysText(STRESS_ABSENCE_DAYS)}`,
        detail: `Отпуск или болезнь ${formatShort(from)} – ${formatShort(to)}, задачи встают на паузу`,
        taskId: own[0].id,
      },
      { kind: 'absence', personId: p.id, from, to, handoverTo: null },
    );
  }

  const baseHigh = new Set(analysis.alerts.filter((a) => a.severity === 'high').map((a) => a.key));
  const threats: Threat[] = [];
  for (const c of candidates) {
    let after: Analysis;
    try {
      after = analyze(applyChangeSet(state, c.ops), today);
    } catch {
      continue;
    }
    const finishDelta = after.finishIndex - analysis.finishIndex;
    const newProblems = after.alerts.filter(
      (a) => a.severity === 'high' && !baseHigh.has(a.key),
    ).length;
    if (finishDelta <= 0 && newProblems === 0) continue;
    threats.push({
      ...c,
      finishDelta,
      bufferAfter: after.bufferDays,
      // «Сорвёт дедлайн» — только если сейчас он соблюдается; у опаздывающего плана это не новость.
      breaksDeadline: after.bufferDays < 0 && analysis.bufferDays >= 0,
      newProblems,
    });
  }
  threats.sort(
    (a, b) =>
      Number(b.breaksDeadline) - Number(a.breaksDeadline) ||
      b.finishDelta - a.finishDelta ||
      b.newProblems - a.newProblems,
  );
  // Не больше двух сценариев одного типа: иначе список забивают однотипные «отпуска».
  const perKind = new Map<Threat['kind'], number>();
  const top = threats.filter((t) => {
    const n = perKind.get(t.kind) ?? 0;
    perKind.set(t.kind, n + 1);
    return n < STRESS_PER_KIND;
  });
  return top.slice(0, limit);
}

/**
 * Запас прочности: на сколько рабочих дней задача может опоздать, прежде чем сорвётся дедлайн
 * (резерв до финиша + запас до дедлайна).
 */
export function safetyMargin(schedule: TaskSchedule, analysis: Analysis): number {
  return schedule.float + analysis.bufferDays;
}

/** Запас прочности всех незавершённых задач, от самых хрупких. */
export function safetyMargins(
  state: ProjectState,
  analysis: Analysis,
): { taskId: string; days: number }[] {
  return state.tasks
    .filter((t) => t.status !== 'done' && t.durationDays > 0)
    .map((t) => ({ taskId: t.id, days: safetyMargin(analysis.tasks[t.id], analysis) }))
    .sort((a, b) => a.days - b.days);
}
