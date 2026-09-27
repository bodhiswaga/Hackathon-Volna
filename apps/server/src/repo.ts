import type { Dependency, Person, Project, ProjectState, Task } from '@volna/engine';
import { db } from './db';

type Row = Record<string, unknown>;

const str = (v: unknown) => v as string;
const strOrNull = (v: unknown) => (v == null ? null : (v as string));

function toProject(r: Row): Project {
  return {
    id: str(r.id),
    name: str(r.name),
    description: str(r.description),
    startDate: str(r.start_date),
    deadline: str(r.deadline),
    statusDate: strOrNull(r.status_date),
    createdAt: str(r.created_at),
  };
}

function toPerson(r: Row): Person {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    name: str(r.name),
    role: str(r.role),
    color: str(r.color),
  };
}

function toTask(r: Row): Task {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    name: str(r.name),
    description: str(r.description),
    durationDays: Number(r.duration_days),
    status: r.status as Task['status'],
    assigneeId: strOrNull(r.assignee_id),
    dueDate: strOrNull(r.due_date),
    startNotEarlier: strOrNull(r.start_not_earlier),
    actualStart: strOrNull(r.actual_start),
    actualEnd: strOrNull(r.actual_end),
    sortOrder: Number(r.sort_order),
  };
}

function toDependency(r: Row): Dependency {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    predecessorId: str(r.predecessor_id),
    successorId: str(r.successor_id),
    lagDays: Number(r.lag_days),
  };
}

export function listProjects(): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Row[]).map(
    toProject,
  );
}

export function loadState(projectId: string): ProjectState | null {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Row | undefined;
  if (!p) return null;
  return {
    project: toProject(p),
    people: (
      db.prepare('SELECT * FROM people WHERE project_id = ? ORDER BY sort_order, name').all(
        projectId,
      ) as Row[]
    ).map(toPerson),
    tasks: (
      db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order').all(
        projectId,
      ) as Row[]
    ).map(toTask),
    dependencies: (
      db.prepare('SELECT * FROM dependencies WHERE project_id = ?').all(projectId) as Row[]
    ).map(toDependency),
  };
}

export function insertProject(p: Project): void {
  db.prepare(
    `INSERT INTO projects (id, name, description, start_date, deadline, status_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.name, p.description, p.startDate, p.deadline, p.statusDate, p.createdAt);
}

export function updateProject(p: Project): void {
  db.prepare(
    `UPDATE projects SET name = ?, description = ?, start_date = ?, deadline = ?, status_date = ?
     WHERE id = ?`,
  ).run(p.name, p.description, p.startDate, p.deadline, p.statusDate, p.id);
}

export function deleteProject(id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function insertPerson(p: Person, sortOrder: number): void {
  db.prepare(
    'INSERT INTO people (id, project_id, name, role, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(p.id, p.projectId, p.name, p.role, p.color, sortOrder);
}

export function updatePerson(p: Person): void {
  db.prepare('UPDATE people SET name = ?, role = ?, color = ? WHERE id = ?').run(
    p.name,
    p.role,
    p.color,
    p.id,
  );
}

export function deletePerson(id: string): void {
  db.prepare('DELETE FROM people WHERE id = ?').run(id);
}

/** Полностью заменяет задачи и связи проекта (вызывать внутри транзакции). */
export function replaceTasksAndDeps(state: Pick<ProjectState, 'project' | 'tasks' | 'dependencies'>): void {
  const pid = state.project.id;
  db.prepare('DELETE FROM dependencies WHERE project_id = ?').run(pid);
  db.prepare('DELETE FROM tasks WHERE project_id = ?').run(pid);
  const insTask = db.prepare(
    `INSERT INTO tasks (id, project_id, name, description, duration_days, status, assignee_id,
       due_date, start_not_earlier, actual_start, actual_end, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const t of state.tasks) {
    insTask.run(
      t.id,
      pid,
      t.name,
      t.description,
      t.durationDays,
      t.status,
      t.assigneeId,
      t.dueDate,
      t.startNotEarlier,
      t.actualStart,
      t.actualEnd,
      t.sortOrder,
    );
  }
  const insDep = db.prepare(
    `INSERT INTO dependencies (id, project_id, predecessor_id, successor_id, lag_days)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const d of state.dependencies) {
    insDep.run(d.id, pid, d.predecessorId, d.successorId, d.lagDays);
  }
}

export interface ChangeEvent {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  reason: string | null;
  ops: unknown[];
  finishBefore: string;
  finishAfter: string;
  bufferBefore: number;
  bufferAfter: number;
}

export interface Snapshot {
  project: Project;
  tasks: Task[];
  dependencies: Dependency[];
}

export function insertChangeEvent(e: ChangeEvent, snapshotBefore: Snapshot): void {
  db.prepare(
    `INSERT INTO change_events (id, project_id, created_at, title, reason, ops_json,
       snapshot_before_json, finish_before, finish_after, buffer_before, buffer_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.id,
    e.projectId,
    e.createdAt,
    e.title,
    e.reason,
    JSON.stringify(e.ops),
    JSON.stringify(snapshotBefore),
    e.finishBefore,
    e.finishAfter,
    e.bufferBefore,
    e.bufferAfter,
  );
}

function toEvent(r: Row): ChangeEvent {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    createdAt: str(r.created_at),
    title: str(r.title),
    reason: strOrNull(r.reason),
    ops: JSON.parse(str(r.ops_json)) as unknown[],
    finishBefore: str(r.finish_before),
    finishAfter: str(r.finish_after),
    bufferBefore: Number(r.buffer_before),
    bufferAfter: Number(r.buffer_after),
  };
}

export function listChangeEvents(projectId: string): ChangeEvent[] {
  return (
    db
      .prepare('SELECT * FROM change_events WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Row[]
  ).map(toEvent);
}

export function getSnapshot(projectId: string, eventId: string): { event: ChangeEvent; snapshot: Snapshot } | null {
  const r = db
    .prepare('SELECT * FROM change_events WHERE project_id = ? AND id = ?')
    .get(projectId, eventId) as Row | undefined;
  if (!r) return null;
  return { event: toEvent(r), snapshot: JSON.parse(str(r.snapshot_before_json)) as Snapshot };
}
