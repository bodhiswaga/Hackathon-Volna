import { effectiveToday, forwardPass } from './analyze';
import { endIndex, indexToDate, startIndex } from './calendar';
import { buildAdjacency, topoSort } from './graph';
import type { Forecast, ISODate, Person, ProjectState, Spread, Task } from './types';

export const FORECAST_RUNS = 2000;
export const FORECAST_SEED = 20260928;

export const SPREAD: Spread = { optimistic: 0.9, pessimistic: 1.3, riskyPessimistic: 1.6 };

export interface ForecastOptions {
  runs?: number;
  seed?: number;
  spread?: Spread;
}

/** Хэш строки (FNV-1a). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Перемешивание 32-битного числа (финализатор murmur3). */
function mix(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

function triangular(u: number, a: number, c: number, b: number): number {
  if (b <= a) return c;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

/** Подрядчик отмечается ролью участника («Подрядчик: платежи»): отдельного типа людей в модели нет. */
const CONTRACTOR_ROLE = /подрядчик/i;

/** Задача с повышенной неопределённостью: заблокирована или её делает подрядчик. */
export function isRiskyTask(task: Task, people: Person[]): boolean {
  if (task.status === 'blocked') return true;
  const role = people.find((p) => p.id === task.assigneeId)?.role ?? '';
  return CONTRACTOR_ROLE.test(role);
}

/**
 * Вероятностный прогноз срока (Монте-Карло поверх того же прямого прохода CPM).
 * Случайное число задачи зависит только от seed, номера прогона и самой задачи — «общие случайные
 * числа»: разница прогнозов до и после изменения отражает само изменение, а не шум.
 */
export function forecast(
  state: ProjectState,
  today: ISODate,
  opts: ForecastOptions = {},
): Forecast {
  const runs = Math.max(1, opts.runs ?? FORECAST_RUNS);
  const seed = opts.seed ?? FORECAST_SEED;
  const spread = opts.spread ?? SPREAD;

  const todayIdx = startIndex(effectiveToday(state, today));
  const startIdx = startIndex(state.project.startDate);
  const deadlineIdx = endIndex(state.project.deadline);
  const adj = buildAdjacency(state.tasks, state.dependencies);
  const order = topoSort(state.tasks, adj);

  const finishOf = (rows: ReturnType<typeof forwardPass>) => {
    let finish = startIdx;
    for (const r of rows.values()) finish = Math.max(finish, r.ef);
    return finish;
  };
  const planFinish = finishOf(forwardPass(state, order, adj, startIdx, todayIdx));

  // Ключ — порядок и название, а не id: у пересозданного демо те же задачи получают те же числа.
  const hashes = new Map(state.tasks.map((t) => [t.id, hashString(`${t.sortOrder}|${t.name}`)]));
  const pessimistic = new Map(
    state.tasks.map((t) => [
      t.id,
      isRiskyTask(t, state.people) ? spread.riskyPessimistic : spread.pessimistic,
    ]),
  );
  const done = new Set(state.tasks.filter((t) => t.status === 'done').map((t) => t.id));

  const finishes = new Int32Array(runs);
  const driverCount = new Map<string, number>();

  for (let run = 0; run < runs; run++) {
    const runKey = mix(seed + Math.imul(run + 1, 0x9e3779b1));
    const durationOf = (t: Task): number => {
      const dur = t.durationDays;
      if (t.status === 'done' || dur === 0) return dur;
      const u = mix(hashes.get(t.id)! ^ runKey) / 4294967296;
      const factor = triangular(u, spread.optimistic, 1, pessimistic.get(t.id)!);
      if (t.status === 'in_progress' && t.actualStart) {
        // Варьируется только остаток работы: прошедшие дни уже прожиты.
        const elapsed = Math.max(0, todayIdx - startIndex(t.actualStart));
        const remaining = Math.max(1, dur - elapsed);
        return elapsed + Math.max(1, Math.round(remaining * factor));
      }
      return Math.max(1, Math.round(dur * factor));
    };

    const rows = forwardPass(state, order, adj, startIdx, todayIdx, durationOf);
    let finish = startIdx;
    let last: string | null = null;
    for (const id of order) {
      const ef = rows.get(id)!.ef;
      if (ef > finish || (ef === finish && last === null)) {
        finish = Math.max(finish, ef);
        last = id;
      }
    }
    finishes[run] = finish;

    // Цепочка, определившая финиш в этом прогоне.
    const seen = new Set<string>();
    let cur = last;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (!done.has(cur)) driverCount.set(cur, (driverCount.get(cur) ?? 0) + 1);
      const drv = rows.get(cur)!.driver;
      cur = drv.kind === 'dependency' ? drv.taskId : null;
    }
  }

  const sorted = Array.from(finishes).sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.min(runs - 1, Math.max(0, Math.ceil(q * runs) - 1))];
  const dateOf = (finish: number) =>
    finish > startIdx ? indexToDate(finish - 1) : indexToDate(startIdx);

  const counts = new Map<number, number>();
  for (const f of sorted) counts.set(f, (counts.get(f) ?? 0) + 1);

  return {
    runs,
    chance: sorted.filter((f) => f <= deadlineIdx).length / runs,
    planChance: sorted.filter((f) => f <= planFinish).length / runs,
    p50: dateOf(quantile(0.5)),
    p80: dateOf(quantile(0.8)),
    p95: dateOf(quantile(0.95)),
    histogram: [...counts].map(([index, count]) => ({ index, date: dateOf(index), count })),
    drivers: [...driverCount]
      .map(([taskId, n]) => ({ taskId, share: n / runs }))
      .sort((a, b) => b.share - a.share),
  };
}
