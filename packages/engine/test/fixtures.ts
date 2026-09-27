import type { Dependency, Person, ProjectState, Task } from '../src/types';

export const START = '2026-09-07'; // понедельник

let seq = 0;

export function task(id: string, durationDays: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p',
    name: id,
    description: '',
    durationDays,
    status: 'not_started',
    assigneeId: null,
    dueDate: null,
    startNotEarlier: null,
    actualStart: null,
    actualEnd: null,
    sortOrder: seq++,
    ...extra,
  };
}

export function dep(pred: string, succ: string, lagDays = 0): Dependency {
  return { id: `${pred}>${succ}`, projectId: 'p', predecessorId: pred, successorId: succ, lagDays };
}

export function person(id: string): Person {
  return { id, projectId: 'p', name: id, role: '', color: '#000' };
}

export function state(
  tasks: Task[],
  dependencies: Dependency[],
  opts: { deadline?: string; people?: Person[] } = {},
): ProjectState {
  return {
    project: {
      id: 'p',
      name: 'Тест',
      description: '',
      startDate: START,
      deadline: opts.deadline ?? '2026-12-31',
      statusDate: null,
      createdAt: '',
    },
    people: opts.people ?? [],
    tasks,
    dependencies,
  };
}
