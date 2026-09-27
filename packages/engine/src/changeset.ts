import { daysText, formatShort } from './calendar';
import { buildAdjacency, CycleError, topoSort } from './graph';
import type {
  Analysis,
  ChangeOp,
  ISODate,
  ProjectState,
  Task,
  TaskPatch,
  TaskStatus,
} from './types';

export class ChangeSetError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid' | 'cycle' | 'duplicate',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value: ISODate | null | undefined, field: string) {
  if (value != null && !DATE_RE.test(value)) {
    throw new ChangeSetError('invalid', `Некорректная дата в поле ${field}`);
  }
}

function validateTask(t: Task, state: ProjectState) {
  if (!t.name.trim()) throw new ChangeSetError('invalid', 'Название задачи не может быть пустым');
  if (!Number.isInteger(t.durationDays) || t.durationDays < 0 || t.durationDays > 1000) {
    throw new ChangeSetError('invalid', `Некорректная длительность у «${t.name}»`);
  }
  if (t.assigneeId && !state.people.some((p) => p.id === t.assigneeId)) {
    throw new ChangeSetError('not_found', 'Ответственный не найден');
  }
  checkDate(t.dueDate, 'dueDate');
  checkDate(t.startNotEarlier, 'startNotEarlier');
  checkDate(t.actualStart, 'actualStart');
  checkDate(t.actualEnd, 'actualEnd');
}

/** Применяет набор операций к состоянию проекта. Чистая функция; бросает ChangeSetError. */
export function applyChangeSet(state: ProjectState, ops: ChangeOp[]): ProjectState {
  const next: ProjectState = {
    project: { ...state.project },
    people: state.people,
    tasks: state.tasks.map((t) => ({ ...t })),
    dependencies: state.dependencies.map((d) => ({ ...d })),
  };

  for (const op of ops) {
    switch (op.type) {
      case 'updateTask': {
        const idx = next.tasks.findIndex((t) => t.id === op.taskId);
        if (idx < 0) throw new ChangeSetError('not_found', 'Задача не найдена');
        next.tasks[idx] = { ...next.tasks[idx], ...op.patch };
        validateTask(next.tasks[idx], next);
        break;
      }
      case 'createTask': {
        if (next.tasks.some((t) => t.id === op.task.id)) {
          throw new ChangeSetError('duplicate', 'Задача с таким id уже существует');
        }
        const task = { ...op.task, projectId: next.project.id };
        validateTask(task, next);
        next.tasks.push(task);
        break;
      }
      case 'deleteTask': {
        if (!next.tasks.some((t) => t.id === op.taskId)) {
          throw new ChangeSetError('not_found', 'Задача не найдена');
        }
        next.tasks = next.tasks.filter((t) => t.id !== op.taskId);
        next.dependencies = next.dependencies.filter(
          (d) => d.predecessorId !== op.taskId && d.successorId !== op.taskId,
        );
        break;
      }
      case 'addDependency': {
        const d = { ...op.dependency, projectId: next.project.id };
        if (d.predecessorId === d.successorId) {
          throw new ChangeSetError('invalid', 'Задача не может зависеть от самой себя');
        }
        if (
          !next.tasks.some((t) => t.id === d.predecessorId) ||
          !next.tasks.some((t) => t.id === d.successorId)
        ) {
          throw new ChangeSetError('not_found', 'Задача для связи не найдена');
        }
        if (
          next.dependencies.some(
            (x) => x.predecessorId === d.predecessorId && x.successorId === d.successorId,
          )
        ) {
          throw new ChangeSetError('duplicate', 'Такая связь уже есть');
        }
        next.dependencies.push(d);
        break;
      }
      case 'removeDependency': {
        if (!next.dependencies.some((d) => d.id === op.dependencyId)) {
          throw new ChangeSetError('not_found', 'Связь не найдена');
        }
        next.dependencies = next.dependencies.filter((d) => d.id !== op.dependencyId);
        break;
      }
      case 'updateDependency': {
        const d = next.dependencies.find((x) => x.id === op.dependencyId);
        if (!d) throw new ChangeSetError('not_found', 'Связь не найдена');
        d.lagDays = op.lagDays;
        break;
      }
      case 'updateProject': {
        next.project = { ...next.project, ...op.patch };
        checkDate(next.project.startDate, 'startDate');
        checkDate(next.project.deadline, 'deadline');
        checkDate(next.project.statusDate, 'statusDate');
        break;
      }
    }
  }

  // Отрицательный лаг — нахлёст: последователь стартует до окончания предшественника,
  // но не раньше его начала.
  for (const d of next.dependencies) {
    const pred = next.tasks.find((t) => t.id === d.predecessorId)!;
    if (!Number.isInteger(d.lagDays) || d.lagDays < -pred.durationDays) {
      throw new ChangeSetError(
        'invalid',
        `Нахлёст после «${pred.name}» не может быть больше её длительности`,
      );
    }
  }

  try {
    topoSort(next.tasks, buildAdjacency(next.tasks, next.dependencies));
  } catch (e) {
    if (e instanceof CycleError) {
      const names = e.taskIds
        .map((id) => next.tasks.find((t) => t.id === id)?.name)
        .filter(Boolean)
        .map((n) => `«${n}»`);
      throw new ChangeSetError(
        'cycle',
        `Связь создаёт цикл: ${names.join(' → ')}`,
        { taskIds: e.taskIds },
      );
    }
    throw e;
  }
  return next;
}

/**
 * Патч смены статуса с автозаполнением фактических дат:
 * «в работе» — фактический старт сегодня, «выполнена» — окончание сегодня.
 */
export function statusPatch(
  task: Task,
  status: TaskStatus,
  analysis: Analysis,
): TaskPatch {
  const today = analysis.today;
  const sched = analysis.tasks[task.id];
  switch (status) {
    case 'not_started':
    case 'blocked':
      return { status, actualStart: null, actualEnd: null };
    case 'in_progress':
      return { status, actualStart: task.actualStart ?? today, actualEnd: null };
    case 'done': {
      const plannedStart = sched?.startDate ?? today;
      const actualStart = task.actualStart ?? (plannedStart < today ? plannedStart : today);
      return { status, actualStart, actualEnd: today };
    }
  }
}

/** Слияние операций черновика: повторные правки одной задачи объединяются в один патч. */
export function mergeOps(ops: ChangeOp[], op: ChangeOp): ChangeOp[] {
  if (op.type === 'updateTask') {
    const created = ops.findIndex((o) => o.type === 'createTask' && o.task.id === op.taskId);
    if (created >= 0) {
      const c = ops[created] as Extract<ChangeOp, { type: 'createTask' }>;
      const copy = [...ops];
      copy[created] = { type: 'createTask', task: { ...c.task, ...op.patch } };
      return copy;
    }
    const idx = ops.findIndex((o) => o.type === 'updateTask' && o.taskId === op.taskId);
    if (idx >= 0) {
      const u = ops[idx] as Extract<ChangeOp, { type: 'updateTask' }>;
      const copy = [...ops];
      copy[idx] = { ...u, patch: { ...u.patch, ...op.patch } };
      return copy;
    }
  }
  if (op.type === 'updateProject') {
    const idx = ops.findIndex((o) => o.type === 'updateProject');
    if (idx >= 0) {
      const u = ops[idx] as Extract<ChangeOp, { type: 'updateProject' }>;
      const copy = [...ops];
      copy[idx] = { ...u, patch: { ...u.patch, ...op.patch } };
      return copy;
    }
  }
  if (op.type === 'removeDependency') {
    const added = ops.findIndex(
      (o) => o.type === 'addDependency' && o.dependency.id === op.dependencyId,
    );
    if (added >= 0) return ops.filter((_, i) => i !== added);
  }
  if (op.type === 'deleteTask') {
    const created = ops.findIndex((o) => o.type === 'createTask' && o.task.id === op.taskId);
    if (created >= 0) {
      return ops.filter(
        (o, i) =>
          i !== created &&
          !(o.type === 'updateTask' && o.taskId === op.taskId) &&
          !(
            o.type === 'addDependency' &&
            (o.dependency.predecessorId === op.taskId || o.dependency.successorId === op.taskId)
          ),
      );
    }
  }
  return [...ops, op];
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'не начата',
  in_progress: 'в работе',
  blocked: 'заблокирована',
  done: 'выполнена',
};

/** Человекочитаемое описание операций (для журнала и заголовка черновика). */
export function describeOps(state: ProjectState, ops: ChangeOp[]): string[] {
  const createdNames = new Map(
    ops.flatMap((o) => (o.type === 'createTask' ? [[o.task.id, o.task.name] as const] : [])),
  );
  const taskName = (id: string) =>
    `«${state.tasks.find((t) => t.id === id)?.name ?? createdNames.get(id) ?? 'задача'}»`;
  const person = (id: string | null | undefined) =>
    id ? (state.people.find((p) => p.id === id)?.name ?? '—') : 'никто';
  const lines: string[] = [];

  for (const op of ops) {
    switch (op.type) {
      case 'updateTask': {
        const before = state.tasks.find((t) => t.id === op.taskId);
        const n = taskName(op.taskId);
        const p = op.patch;
        const countBefore = lines.length;
        if (p.durationDays !== undefined && before && p.durationDays !== before.durationDays) {
          lines.push(`${n}: длительность ${before.durationDays} → ${daysText(p.durationDays)}`);
        }
        if (p.status !== undefined && before && p.status !== before.status) {
          lines.push(`${n}: статус «${STATUS_LABEL[p.status]}»`);
        }
        if (p.assigneeId !== undefined && before && p.assigneeId !== before.assigneeId) {
          lines.push(`${n}: ответственный ${person(before.assigneeId)} → ${person(p.assigneeId)}`);
        }
        if (p.startNotEarlier !== undefined && before && p.startNotEarlier !== before.startNotEarlier) {
          lines.push(
            p.startNotEarlier
              ? `${n}: старт не раньше ${formatShort(p.startNotEarlier)}`
              : `${n}: снято ограничение по старту`,
          );
        }
        if (p.dueDate !== undefined && before && p.dueDate !== before.dueDate) {
          lines.push(p.dueDate ? `${n}: срок ${formatShort(p.dueDate)}` : `${n}: срок снят`);
        }
        if (p.name !== undefined && before && p.name !== before.name) {
          lines.push(`«${before.name}» переименована в «${p.name}»`);
        }
        if (lines.length === countBefore) lines.push(`${n}: правка параметров`);
        break;
      }
      case 'createTask':
        lines.push(`Новая задача «${op.task.name}»`);
        break;
      case 'deleteTask':
        lines.push(`Удалена задача ${taskName(op.taskId)}`);
        break;
      case 'addDependency':
        lines.push(
          `Связь ${taskName(op.dependency.predecessorId)} → ${taskName(op.dependency.successorId)}`,
        );
        break;
      case 'removeDependency': {
        const d = state.dependencies.find((x) => x.id === op.dependencyId);
        lines.push(
          d
            ? `Убрана связь ${taskName(d.predecessorId)} → ${taskName(d.successorId)}`
            : 'Убрана связь',
        );
        break;
      }
      case 'updateDependency': {
        const d = state.dependencies.find((x) => x.id === op.dependencyId);
        lines.push(
          d
            ? op.lagDays < 0
              ? `${taskName(d.successorId)} стартует за ${daysText(-op.lagDays)} до окончания ${taskName(d.predecessorId)}`
              : `Пауза ${taskName(d.predecessorId)} → ${taskName(d.successorId)}: ${daysText(op.lagDays)}`
            : 'Изменена задержка связи',
        );
        break;
      }
      case 'updateProject': {
        const p = op.patch;
        if (p.deadline && p.deadline !== state.project.deadline) {
          lines.push(`Дедлайн проекта → ${formatShort(p.deadline)}`);
        }
        if (p.startDate && p.startDate !== state.project.startDate) {
          lines.push(`Старт проекта → ${formatShort(p.startDate)}`);
        }
        if (p.name && p.name !== state.project.name) lines.push(`Проект переименован`);
        if (p.statusDate !== undefined && p.statusDate !== state.project.statusDate) {
          lines.push(p.statusDate ? `Дата статуса → ${formatShort(p.statusDate)}` : 'Дата статуса — сегодня');
        }
        break;
      }
    }
  }
  return lines;
}
