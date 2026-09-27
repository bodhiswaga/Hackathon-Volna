import {
  daysText,
  endIndex,
  formatShort,
  indexToDate,
  startIndex,
} from './calendar';
import { buildAdjacency, topoSort, type Adjacency } from './graph';
import type {
  Alert,
  Analysis,
  Driver,
  Health,
  ISODate,
  ProjectState,
  RiskLevel,
  Task,
  TaskFlags,
  TaskSchedule,
} from './types';

/** Резерв (в рабочих днях), при котором задача считается «на грани». */
export const LOW_FLOAT_DAYS = 2;
/** Запас до дедлайна, ниже которого проект требует внимания. */
export const LOW_BUFFER_DAYS = 2;

interface Row {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  driver: Driver;
}

export function effectiveToday(state: ProjectState, today: ISODate): ISODate {
  return state.project.statusDate ?? today;
}

/** Дата отображения конца задачи: последний рабочий день; веха — день перед es. */
function displayEnd(es: number, ef: number, startIdx: number): ISODate {
  if (ef > es) return indexToDate(ef - 1);
  return indexToDate(es > startIdx ? es - 1 : es);
}

function forwardPass(
  state: ProjectState,
  order: string[],
  adj: Adjacency,
  startIdx: number,
  todayIdx: number,
): Map<string, Row> {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const rows = new Map<string, Row>();

  for (const id of order) {
    const t = byId.get(id)!;
    const dur = t.durationDays;

    if (t.status === 'done' && t.actualEnd) {
      const ef = endIndex(t.actualEnd);
      let es = dur === 0 ? ef : t.actualStart ? startIndex(t.actualStart) : ef - dur;
      if (es > ef) es = ef;
      rows.set(id, { es, ef, ls: es, lf: ef, driver: { kind: 'actual' } });
      continue;
    }
    if (t.status === 'in_progress' && t.actualStart && dur > 0) {
      const es = startIndex(t.actualStart);
      // Незавершённая задача не может закончиться в прошлом.
      const ef = Math.max(es + dur, todayIdx + 1);
      rows.set(id, { es, ef, ls: es, lf: ef, driver: { kind: 'actual' } });
      continue;
    }

    // Порядок проверки важен: при равенстве объясняем сдвиг зависимостью.
    let es = -Infinity;
    let driver: Driver = { kind: 'projectStart' };
    for (const d of adj.preds.get(id)!) {
      const v = rows.get(d.predecessorId)!.ef + d.lagDays;
      if (v > es) {
        es = v;
        driver = {
          kind: 'dependency',
          taskId: d.predecessorId,
          dependencyId: d.id,
          lagDays: d.lagDays,
        };
      }
    }
    if (t.startNotEarlier) {
      const v = startIndex(t.startNotEarlier);
      if (v > es) {
        es = v;
        driver = { kind: 'constraint' };
      }
    }
    if (t.status !== 'done' && todayIdx > es) {
      es = todayIdx;
      driver = { kind: 'today' };
    }
    if (startIdx > es) {
      es = startIdx;
      driver = { kind: 'projectStart' };
    }
    rows.set(id, { es, ef: es + dur, ls: es, lf: es + dur, driver });
  }
  return rows;
}

function backwardPass(
  state: ProjectState,
  order: string[],
  adj: Adjacency,
  rows: Map<string, Row>,
  finish: number,
): void {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const row = rows.get(id)!;
    let lf = finish;
    for (const d of adj.succs.get(id)!) {
      if (byId.get(d.successorId)!.status === 'done') continue;
      lf = Math.min(lf, rows.get(d.successorId)!.ls - d.lagDays);
    }
    row.lf = lf;
    row.ls = lf - (row.ef - row.es);
  }
}

function findOverlaps(state: ProjectState, rows: Map<string, Row>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const byPerson = new Map<string, Task[]>();
  for (const t of state.tasks) {
    if (t.status === 'done' || !t.assigneeId || t.durationDays === 0) continue;
    const list = byPerson.get(t.assigneeId) ?? [];
    list.push(t);
    byPerson.set(t.assigneeId, list);
  }
  for (const list of byPerson.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = rows.get(list[i].id)!;
        const b = rows.get(list[j].id)!;
        if (a.es < b.ef && b.es < a.ef) {
          result.set(list[i].id, [...(result.get(list[i].id) ?? []), list[j].id]);
          result.set(list[j].id, [...(result.get(list[j].id) ?? []), list[i].id]);
        }
      }
    }
  }
  return result;
}

function riskOf(f: TaskFlags): RiskLevel {
  if (f.missesDueDate || f.pastDeadline || f.overdue || f.blocked) return 'high';
  if (f.critical || f.lowFloat || f.overloaded || f.blockedByPredecessor) return 'medium';
  return 'none';
}

/** Полный расчёт проекта: расписание (CPM), флаги риска, алерты и общее здоровье. */
export function analyze(state: ProjectState, today: ISODate): Analysis {
  const todayDate = effectiveToday(state, today);
  const todayIdx = startIndex(todayDate);
  const startIdx = startIndex(state.project.startDate);
  const deadlineIdx = endIndex(state.project.deadline);

  const adj = buildAdjacency(state.tasks, state.dependencies);
  const order = topoSort(state.tasks, adj);
  const rows = forwardPass(state, order, adj, startIdx, todayIdx);

  let finish = startIdx;
  for (const r of rows.values()) finish = Math.max(finish, r.ef);
  backwardPass(state, order, adj, rows, finish);

  const overlaps = findOverlaps(state, rows);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const tasks: Record<string, TaskSchedule> = {};

  for (const id of order) {
    const t = byId.get(id)!;
    const r = rows.get(id)!;
    const done = t.status === 'done';
    const float = r.lf - r.ef;
    const endDate = displayEnd(r.es, r.ef, startIdx);
    const plannedEndIdx = t.actualStart ? startIndex(t.actualStart) + t.durationDays : null;
    const flags: TaskFlags = {
      critical: !done && float <= 0,
      lowFloat: !done && float > 0 && float <= LOW_FLOAT_DAYS,
      missesDueDate: !done && t.dueDate !== null && r.ef > endIndex(t.dueDate),
      pastDeadline: !done && r.ef > deadlineIdx,
      overdue:
        !done &&
        ((t.dueDate !== null && endIndex(t.dueDate) <= todayIdx) ||
          (t.status === 'in_progress' && plannedEndIdx !== null && plannedEndIdx <= todayIdx)),
      blocked: t.status === 'blocked',
      blockedByPredecessor:
        t.status === 'in_progress' &&
        adj.preds.get(id)!.some((d) => byId.get(d.predecessorId)!.status !== 'done'),
      overloaded: overlaps.has(id),
    };
    tasks[id] = {
      taskId: id,
      es: r.es,
      ef: r.ef,
      ls: r.ls,
      lf: r.lf,
      float,
      // Веха — событие одного дня: начало совпадает с окончанием.
      startDate: r.ef > r.es ? indexToDate(r.es) : endDate,
      endDate,
      driver: r.driver,
      flags,
      risk: done ? 'none' : riskOf(flags),
      overlapsWith: overlaps.get(id) ?? [],
    };
  }

  const criticalPath = order.filter((id) => tasks[id].flags.critical);
  const criticalDependencyIds = state.dependencies
    .filter((d) => {
      const p = tasks[d.predecessorId];
      const s = tasks[d.successorId];
      return p && s && p.flags.critical && s.flags.critical && p.ef + d.lagDays === s.es;
    })
    .map((d) => d.id);

  const bufferDays = deadlineIdx - finish;
  const finishDate = finish > startIdx ? indexToDate(finish - 1) : indexToDate(startIdx);
  const alerts = buildAlerts(state, tasks, order, adj, bufferDays, finishDate);
  const health: Health = alerts.some((a) => a.severity === 'high')
    ? 'intervention'
    : alerts.some((a) => a.severity === 'medium')
      ? 'attention'
      : 'ok';

  const totalDur = state.tasks.reduce((s, t) => s + t.durationDays, 0);
  const doneDur = state.tasks
    .filter((t) => t.status === 'done')
    .reduce((s, t) => s + t.durationDays, 0);
  const doneCount = state.tasks.filter((t) => t.status === 'done').length;

  return {
    today: todayDate,
    todayIndex: todayIdx,
    startIndex: startIdx,
    tasks,
    order,
    criticalPath,
    criticalDependencyIds,
    finishIndex: finish,
    finishDate,
    deadlineIndex: deadlineIdx,
    bufferDays,
    alerts,
    health,
    stats: {
      total: state.tasks.length,
      done: doneCount,
      inProgress: state.tasks.filter((t) => t.status === 'in_progress').length,
      blocked: state.tasks.filter((t) => t.status === 'blocked').length,
      critical: criticalPath.length,
      threatened: Object.values(tasks).filter((s) => s.risk === 'high').length,
      progressPct:
        state.tasks.length === 0
          ? 0
          : Math.round(
              totalDur > 0 ? (doneDur / totalDur) * 100 : (doneCount / state.tasks.length) * 100,
            ),
    },
  };
}

function buildAlerts(
  state: ProjectState,
  tasks: Record<string, TaskSchedule>,
  order: string[],
  adj: Adjacency,
  bufferDays: number,
  finishDate: ISODate,
): Alert[] {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const name = (id: string) => `«${byId.get(id)!.name}»`;
  const alerts: Alert[] = [];

  if (bufferDays < 0) {
    alerts.push({
      key: 'deadline_missed',
      severity: 'high',
      code: 'deadline_missed',
      text: `Прогноз окончания ${formatShort(finishDate)} — позже дедлайна ${formatShort(state.project.deadline)} на ${daysText(-bufferDays)}`,
      taskIds: order.filter((id) => tasks[id].flags.critical),
    });
  } else if (bufferDays <= LOW_BUFFER_DAYS && state.tasks.length > 0) {
    alerts.push({
      key: 'low_buffer',
      severity: 'medium',
      code: 'low_buffer',
      text:
        bufferDays === 0
          ? 'Запаса до дедлайна нет — любая задержка на критическом пути сдвинет срок'
          : `Запас до дедлайна всего ${daysText(bufferDays)}`,
      taskIds: order.filter((id) => tasks[id].flags.critical),
    });
  }

  for (const id of order) {
    const t = byId.get(id)!;
    const s = tasks[id];
    if (s.flags.blocked) {
      alerts.push({
        key: `blocked:${id}`,
        severity: 'high',
        code: 'blocked',
        text: `${name(id)} заблокирована — нужна помощь руководителя`,
        taskIds: [id],
      });
    }
    if (s.flags.overdue) {
      alerts.push({
        key: `overdue:${id}`,
        severity: 'high',
        code: 'overdue',
        text: `${name(id)} просрочена — должна была завершиться раньше`,
        taskIds: [id],
      });
    } else if (s.flags.missesDueDate && t.dueDate) {
      alerts.push({
        key: `due:${id}`,
        severity: 'high',
        code: 'due_date_missed',
        text: `${name(id)} не успевает к сроку ${formatShort(t.dueDate)}: прогноз ${formatShort(s.endDate)}`,
        taskIds: [id],
      });
    }
    if (s.flags.blockedByPredecessor) {
      const pending = adj.preds
        .get(id)!
        .filter((d) => byId.get(d.predecessorId)!.status !== 'done')
        .map((d) => name(d.predecessorId));
      alerts.push({
        key: `blockedby:${id}`,
        severity: 'medium',
        code: 'blocked_by_predecessor',
        text: `${name(id)} уже в работе, но не завершена ${pending.join(', ')}`,
        taskIds: [id],
      });
    }
  }

  const peopleById = new Map(state.people.map((p) => [p.id, p]));
  const seenPeople = new Set<string>();
  for (const id of order) {
    const s = tasks[id];
    const assigneeId = byId.get(id)!.assigneeId;
    if (!s.flags.overloaded || !assigneeId || seenPeople.has(assigneeId)) continue;
    seenPeople.add(assigneeId);
    const group = order.filter(
      (tid) => tasks[tid].flags.overloaded && byId.get(tid)!.assigneeId === assigneeId,
    );
    alerts.push({
      key: `overloaded:${assigneeId}:${group.join(',')}`,
      severity: 'medium',
      code: 'overloaded',
      text: `${peopleById.get(assigneeId)?.name ?? 'Исполнитель'} ведёт параллельно: ${group.map(name).join(', ')}`,
      taskIds: group,
    });
  }

  const weight = { high: 0, medium: 1, info: 2 };
  return alerts.sort((a, b) => weight[a.severity] - weight[b.severity]);
}
