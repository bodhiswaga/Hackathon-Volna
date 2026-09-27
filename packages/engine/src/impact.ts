import { daysText } from './calendar';
import type {
  Alert,
  Analysis,
  ChangeOp,
  Health,
  ISODate,
  ProjectState,
  RiskLevel,
} from './types';

export interface TaskImpact {
  taskId: string;
  name: string;
  /** Задача изменена самим пользователем (а не сдвинута волной). */
  direct: boolean;
  created: boolean;
  startBefore: ISODate | null;
  startAfter: ISODate;
  endBefore: ISODate | null;
  endAfter: ISODate;
  /** Сдвиг в рабочих днях (после − до). */
  deltaStart: number;
  deltaEnd: number;
  /** Цепочка распространения: от первопричины к этой задаче. */
  chain: string[];
  reason: string;
  riskBefore: RiskLevel;
  riskAfter: RiskLevel;
  criticalBefore: boolean;
  criticalAfter: boolean;
}

export interface ImpactReport {
  directTaskIds: string[];
  deleted: { taskId: string; name: string }[];
  affected: TaskImpact[];
  /** Сколько задач сдвинулось волной (не считая изменённых напрямую). */
  wavedCount: number;
  finishBefore: ISODate;
  finishAfter: ISODate;
  finishDelta: number;
  deadlineBefore: ISODate;
  deadlineAfter: ISODate;
  bufferBefore: number;
  bufferAfter: number;
  newAlerts: Alert[];
  resolvedAlerts: Alert[];
  criticalAdded: string[];
  criticalRemoved: string[];
  verdict: Health;
  headline: string;
  attention: string[];
}

function directTaskIds(before: ProjectState, ops: ChangeOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.type === 'updateTask') ids.add(op.taskId);
    if (op.type === 'createTask') ids.add(op.task.id);
    if (op.type === 'addDependency') ids.add(op.dependency.successorId);
    if (op.type === 'removeDependency' || op.type === 'updateDependency') {
      const d = before.dependencies.find((x) => x.id === op.dependencyId);
      if (d) ids.add(d.successorId);
    }
  }
  return ids;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Сравнивает два расчёта проекта и объясняет, что изменилось и почему. */
export function diffAnalyses(
  beforeState: ProjectState,
  before: Analysis,
  afterState: ProjectState,
  after: Analysis,
  ops: ChangeOp[],
): ImpactReport {
  const direct = directTaskIds(beforeState, ops);
  const nameOf = new Map(
    [...beforeState.tasks, ...afterState.tasks].map((t) => [t.id, t.name] as const),
  );
  const name = (id: string) => `«${nameOf.get(id) ?? '?'}»`;

  const deltaEnd = (id: string) => {
    const b = before.tasks[id];
    const a = after.tasks[id];
    return b && a ? a.ef - b.ef : 0;
  };

  const affected: TaskImpact[] = [];
  for (const id of after.order) {
    const a = after.tasks[id];
    const b = before.tasks[id];
    const dS = b ? a.es - b.es : 0;
    const dE = b ? a.ef - b.ef : 0;
    const isDirect = direct.has(id);
    if (!isDirect && dS === 0 && dE === 0) continue;

    const chain = [id];
    let cur = id;
    const guard = new Set<string>([id]);
    while (!direct.has(cur)) {
      const drv = after.tasks[cur].driver;
      if (drv.kind !== 'dependency' || guard.has(drv.taskId)) break;
      chain.push(drv.taskId);
      guard.add(drv.taskId);
      if (direct.has(drv.taskId) || deltaEnd(drv.taskId) === 0) break;
      cur = drv.taskId;
    }
    chain.reverse();

    let reason: string;
    if (!b) reason = 'новая задача';
    else if (isDirect) reason = 'изменена напрямую';
    else {
      const drv = a.driver;
      if (drv.kind === 'dependency') {
        const pd = deltaEnd(drv.taskId);
        reason = pd !== 0 ? `вслед за ${name(drv.taskId)} (${signed(pd)} дн.)` : `после ${name(drv.taskId)}`;
      } else if (drv.kind === 'today') reason = 'не может начаться раньше сегодняшнего дня';
      else if (drv.kind === 'constraint') reason = 'ограничение «не раньше»';
      else if (drv.kind === 'projectStart') reason = 'старт проекта';
      else reason = 'фактические даты';
    }

    affected.push({
      taskId: id,
      name: nameOf.get(id) ?? '',
      direct: isDirect,
      created: !b,
      startBefore: b?.startDate ?? null,
      startAfter: a.startDate,
      endBefore: b?.endDate ?? null,
      endAfter: a.endDate,
      deltaStart: dS,
      deltaEnd: dE,
      chain,
      reason,
      riskBefore: b?.risk ?? 'none',
      riskAfter: a.risk,
      criticalBefore: b?.flags.critical ?? false,
      criticalAfter: a.flags.critical,
    });
  }

  const deleted = beforeState.tasks
    .filter((t) => !after.tasks[t.id])
    .map((t) => ({ taskId: t.id, name: t.name }));

  const beforeKeys = new Set(before.alerts.map((a) => a.key));
  const afterKeys = new Set(after.alerts.map((a) => a.key));
  // Алерт дедлайна меняет текст при другом опоздании — считаем его новым, только если его не было.
  const newAlerts = after.alerts.filter((a) => !beforeKeys.has(a.key));
  const resolvedAlerts = before.alerts.filter((a) => !afterKeys.has(a.key));

  const critBefore = new Set(before.criticalPath);
  const critAfter = new Set(after.criticalPath);
  const criticalAdded = after.criticalPath.filter((id) => !critBefore.has(id));
  const criticalRemoved = before.criticalPath.filter((id) => !critAfter.has(id) && after.tasks[id]);

  const finishDelta = after.finishIndex - before.finishIndex;
  const bufferAfter = after.bufferDays;
  const wavedCount = affected.filter((x) => !x.direct && !x.created).length;

  let headline: string;
  if (finishDelta > 0) {
    headline =
      bufferAfter < 0
        ? `Срок проекта сдвигается на ${signed(finishDelta)} раб. дн. и выходит за дедлайн на ${daysText(-bufferAfter)}`
        : `Срок проекта сдвигается на ${signed(finishDelta)} раб. дн., но укладывается в дедлайн (запас ${daysText(bufferAfter)})`;
  } else if (finishDelta < 0) {
    headline =
      bufferAfter < 0
        ? `Проект ускоряется на ${daysText(-finishDelta)}, но всё ещё опаздывает на ${daysText(-bufferAfter)}`
        : `Проект ускоряется на ${daysText(-finishDelta)} — запас до дедлайна ${daysText(bufferAfter)}`;
  } else if (bufferAfter !== before.bufferDays) {
    headline =
      bufferAfter < 0
        ? `Срок проекта не меняется, но дедлайн нарушен на ${daysText(-bufferAfter)}`
        : `Запас до дедлайна: ${daysText(before.bufferDays)} → ${daysText(bufferAfter)}`;
  } else if (wavedCount > 0) {
    headline = `Сдвигаются ${wavedCount} зависимых задач, но срок проекта не меняется`;
  } else {
    headline = 'Срок проекта не меняется';
  }

  const attention: string[] = [];
  for (const a of newAlerts) attention.push(a.text);
  if (criticalAdded.length > 0) {
    attention.push(`На критический путь попали: ${criticalAdded.map(name).join(', ')}`);
  }
  const eatenFloat = affected.filter(
    (x) => !x.criticalBefore && x.criticalAfter === false && x.riskBefore === 'none' && x.riskAfter !== 'none',
  );
  if (eatenFloat.length > 0) {
    attention.push(`Резерв почти исчерпан у ${eatenFloat.map((x) => name(x.taskId)).join(', ')}`);
  }

  let verdict: Health = 'ok';
  if (bufferAfter < 0 || newAlerts.some((a) => a.severity === 'high')) verdict = 'intervention';
  else if (finishDelta > 0 || newAlerts.length > 0 || criticalAdded.length > 0) verdict = 'attention';

  return {
    directTaskIds: [...direct],
    deleted,
    affected,
    wavedCount,
    finishBefore: before.finishDate,
    finishAfter: after.finishDate,
    finishDelta,
    deadlineBefore: beforeState.project.deadline,
    deadlineAfter: afterState.project.deadline,
    bufferBefore: before.bufferDays,
    bufferAfter,
    newAlerts,
    resolvedAlerts,
    criticalAdded,
    criticalRemoved,
    verdict,
    headline,
    attention,
  };
}
