import { analyze } from './analyze';
import { daysText, endIndex, formatShort, indexToDate, startIndex } from './calendar';
import { applyChangeSet, ChangeSetError } from './changeset';
import type {
  ChangeOp,
  CompiledEvent,
  ISODate,
  ProjectEvent,
  ProjectState,
  Task,
  TaskSchedule,
} from './types';

function compileAbsence(
  state: ProjectState,
  today: ISODate,
  e: Extract<ProjectEvent, { kind: 'absence' }>,
): CompiledEvent {
  const person = state.people.find((p) => p.id === e.personId);
  if (!person) throw new ChangeSetError('not_found', 'Сотрудник не найден');
  const from = startIndex(e.from);
  const to = endIndex(e.to);
  if (to <= from) throw new ChangeSetError('invalid', 'В выбранном периоде нет рабочих дней');
  const period = `${formatShort(e.from)} – ${formatShort(e.to)}`;

  if (e.handoverTo) {
    if (e.handoverTo === e.personId) {
      throw new ChangeSetError('invalid', 'Задачи нужно передать другому сотруднику');
    }
    const receiver = state.people.find((p) => p.id === e.handoverTo);
    if (!receiver) throw new ChangeSetError('not_found', 'Сотрудник не найден');
    const a = analyze(state, today);
    const ops: ChangeOp[] = state.tasks
      .filter((t) => {
        const s = a.tasks[t.id];
        return t.assigneeId === e.personId && t.status !== 'done' && s.es < to && s.ef > from;
      })
      .map((t) => ({ type: 'updateTask', taskId: t.id, patch: { assigneeId: receiver.id } }));
    return {
      ops,
      title: `${person.name} отсутствует ${period}, задачи передаются: ${receiver.name}`,
    };
  }

  // Пауза: работа, начатая (или по плану начинающаяся) до отсутствия, встаёт на его время;
  // стартующая в отсутствие — ждёт возвращения. Одного прохода достаточно: обе правки уводят
  // задачи за конец отсутствия, а не в него.
  const returnDate = indexToDate(to);
  const a = analyze(state, today);
  const ops: ChangeOp[] = [];
  for (const t of state.tasks) {
    if (t.assigneeId !== e.personId || t.status === 'done' || t.durationDays === 0) continue;
    const s = a.tasks[t.id];
    if (s.es >= to || s.ef <= from) continue;
    // У задачи в работе «не раньше» не действует — её можно только удлинить.
    const pause = t.status === 'in_progress' || s.es < from;
    ops.push({
      type: 'updateTask',
      taskId: t.id,
      patch: pause
        ? { durationDays: scheduledDuration(t, s) + (to - from) }
        : { startNotEarlier: returnDate },
    });
  }
  return { ops, title: `${person.name} отсутствует ${period}, задачи на паузе` };
}

/**
 * Длительность, на которую задача реально занимает расписание: у просроченной задачи в работе
 * она больше оценки (окончание не раньше завтрашнего дня), и прибавка к оценке была бы поглощена.
 */
export function scheduledDuration(t: Task, s: TaskSchedule): number {
  return Math.max(t.durationDays, s.ef - s.es);
}

/**
 * Превращает событие в операции ChangeSet. Чистая функция: id новых сущностей выдаёт `newId`.
 * Бросает ChangeSetError, если событие некорректно.
 */
export function compileEvent(
  state: ProjectState,
  today: ISODate,
  event: ProjectEvent,
  newId: () => string,
): CompiledEvent {
  const taskOf = (id: string) => {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) throw new ChangeSetError('not_found', 'Задача не найдена');
    return t;
  };

  let compiled: CompiledEvent;
  switch (event.kind) {
    case 'absence':
      compiled = compileAbsence(state, today, event);
      break;
    case 'harder': {
      const t = taskOf(event.taskId);
      if (!Number.isInteger(event.extraDays) || event.extraDays < 1) {
        throw new ChangeSetError('invalid', 'Укажите, на сколько дней задача станет дольше');
      }
      const base =
        t.status === 'in_progress'
          ? scheduledDuration(t, analyze(state, today).tasks[t.id])
          : t.durationDays;
      compiled = {
        ops: [
          { type: 'updateTask', taskId: t.id, patch: { durationDays: base + event.extraDays } },
        ],
        title: `«${t.name}» сложнее оценки: +${daysText(event.extraDays)}`,
      };
      break;
    }
    case 'delay': {
      const t = taskOf(event.taskId);
      if (t.status === 'done' || t.status === 'in_progress') {
        throw new ChangeSetError(
          'invalid',
          `«${t.name}» уже начата — задержать можно только старт`,
        );
      }
      const until =
        t.startNotEarlier && t.startNotEarlier > event.until ? t.startNotEarlier : event.until;
      compiled = {
        ops: [{ type: 'updateTask', taskId: t.id, patch: { startNotEarlier: until } }],
        title: `Задержка старта: «${t.name}» не раньше ${formatShort(until)}`,
      };
      break;
    }
    case 'scope': {
      const id = newId();
      const ops: ChangeOp[] = [
        {
          type: 'createTask',
          task: {
            id,
            projectId: state.project.id,
            name: event.name.trim(),
            description: 'Новое требование заказчика',
            durationDays: event.durationDays,
            status: 'not_started',
            assigneeId: event.assigneeId,
            dueDate: null,
            startNotEarlier: null,
            actualStart: null,
            actualEnd: null,
            sortOrder: Math.max(0, ...state.tasks.map((t) => t.sortOrder)) + 1,
          },
        },
      ];
      const link = (predecessorId: string, successorId: string): ChangeOp => ({
        type: 'addDependency',
        dependency: {
          id: newId(),
          projectId: state.project.id,
          predecessorId,
          successorId,
          lagDays: 0,
        },
      });
      if (event.afterTaskId) ops.push(link(taskOf(event.afterTaskId).id, id));
      if (event.beforeTaskId) ops.push(link(id, taskOf(event.beforeTaskId).id));
      compiled = { ops, title: `Новое требование заказчика: «${event.name.trim()}»` };
      break;
    }
    case 'deadline':
      compiled = {
        ops: [{ type: 'updateProject', patch: { deadline: event.deadline } }],
        title: `Заказчик переносит дедлайн: ${formatShort(state.project.deadline)} → ${formatShort(event.deadline)}`,
      };
      break;
  }
  // Проверка тем же движком, что и при применении: ошибка всплывёт до попадания в черновик.
  applyChangeSet(state, compiled.ops);
  return compiled;
}
