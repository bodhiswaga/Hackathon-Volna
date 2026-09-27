/** Дата в формате YYYY-MM-DD. */
export type ISODate = string;

export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
] as const satisfies readonly TaskStatus[];

export interface Project {
  id: string;
  name: string;
  description: string;
  startDate: ISODate;
  deadline: ISODate;
  /** Дата «сегодня» для расчётов; null — реальная текущая дата. */
  statusDate: ISODate | null;
  createdAt: string;
}

export interface Person {
  id: string;
  projectId: string;
  name: string;
  role: string;
  color: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  description: string;
  /** Длительность в рабочих днях; 0 — веха. */
  durationDays: number;
  status: TaskStatus;
  assigneeId: string | null;
  /** Срок выполнения (включительно). */
  dueDate: ISODate | null;
  /** Ограничение «начать не раньше». */
  startNotEarlier: ISODate | null;
  actualStart: ISODate | null;
  actualEnd: ISODate | null;
  sortOrder: number;
}

/** Зависимость Finish→Start с задержкой в рабочих днях. */
export interface Dependency {
  id: string;
  projectId: string;
  predecessorId: string;
  successorId: string;
  lagDays: number;
}

export interface ProjectState {
  project: Project;
  people: Person[];
  tasks: Task[];
  dependencies: Dependency[];
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'projectId'>>;
export type ProjectPatch = Partial<
  Pick<Project, 'name' | 'description' | 'startDate' | 'deadline' | 'statusDate'>
>;

export type ChangeOp =
  | { type: 'updateTask'; taskId: string; patch: TaskPatch }
  | { type: 'createTask'; task: Task }
  | { type: 'deleteTask'; taskId: string }
  | { type: 'addDependency'; dependency: Dependency }
  | { type: 'removeDependency'; dependencyId: string }
  | { type: 'updateDependency'; dependencyId: string; lagDays: number }
  | { type: 'updateProject'; patch: ProjectPatch };

/** Что определило ранний старт задачи — нужно для объяснения «почему сдвинулась». */
export type Driver =
  | { kind: 'dependency'; taskId: string; dependencyId: string; lagDays: number }
  | { kind: 'constraint' }
  | { kind: 'today' }
  | { kind: 'projectStart' }
  | { kind: 'actual' };

export interface TaskFlags {
  critical: boolean;
  /** 0 < резерв ≤ LOW_FLOAT_DAYS. */
  lowFloat: boolean;
  missesDueDate: boolean;
  pastDeadline: boolean;
  overdue: boolean;
  blocked: boolean;
  blockedByPredecessor: boolean;
  overloaded: boolean;
}

export type RiskLevel = 'none' | 'medium' | 'high';

export interface TaskSchedule {
  taskId: string;
  /** Индексы рабочих дней: es — первый день, ef — день после последнего (полуинтервал). */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  float: number;
  startDate: ISODate;
  /** Последний рабочий день задачи (для вехи — день вехи). */
  endDate: ISODate;
  driver: Driver;
  flags: TaskFlags;
  risk: RiskLevel;
  /** Задачи того же исполнителя, пересекающиеся по времени. */
  overlapsWith: string[];
}

export type Severity = 'high' | 'medium' | 'info';

export interface Alert {
  key: string;
  severity: Severity;
  code:
    | 'deadline_missed'
    | 'low_buffer'
    | 'due_date_missed'
    | 'overdue'
    | 'blocked'
    | 'blocked_by_predecessor'
    | 'overloaded';
  text: string;
  taskIds: string[];
}

export type Health = 'ok' | 'attention' | 'intervention';

export interface Analysis {
  today: ISODate;
  todayIndex: number;
  startIndex: number;
  tasks: Record<string, TaskSchedule>;
  /** Топологический порядок задач. */
  order: string[];
  criticalPath: string[];
  criticalDependencyIds: string[];
  finishIndex: number;
  finishDate: ISODate;
  deadlineIndex: number;
  /** Запас до дедлайна в рабочих днях (отрицательный — опоздание). */
  bufferDays: number;
  alerts: Alert[];
  health: Health;
  stats: {
    total: number;
    done: number;
    inProgress: number;
    blocked: number;
    critical: number;
    threatened: number;
    progressPct: number;
  };
}
