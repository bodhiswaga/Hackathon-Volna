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

// --- Анализ последствий ---

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

// --- Советник по срокам ---

export type SuggestionKind =
  | 'crash'
  | 'parallelize'
  | 'removeLag'
  | 'removeConstraint'
  | 'reassign'
  | 'split'
  | 'moveDeadline';

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  description: string;
  /** Почему совет касается именно этого места плана — из расчёта, а не общими словами. */
  why: string;
  /** Цена человеческими словами: переработка, помощник, риск переделок, переговоры. */
  costText: string;
  ops: ChangeOp[];
  /** На сколько рабочих дней раньше закончится проект. */
  gainDays: number;
  finishAfter: ISODate;
  bufferAfter: number;
  fitsDeadline: boolean;
  /** Условная «цена» решения: 1 — дёшево, 3 — дорого или рискованно. */
  cost: 1 | 2 | 3;
  /** Какие проблемы снимает (тексты алертов). */
  resolves: string[];
  /** Какие новые проблемы создаёт (тексты алертов, которых до решения не было). */
  sideEffects: string[];
}

export interface RecoveryPlan {
  steps: Suggestion[];
  ops: ChangeOp[];
  finishAfter: ISODate;
  bufferAfter: number;
  fitsDeadline: boolean;
}

export interface AdviseOptions {
  /** Доля прогонов «Шанса успеть», где задача определяла финиш (Forecast.drivers). */
  drivers?: { taskId: string; share: number }[];
  /** Генератор id для новых задач и связей: движок чистый, без randomUUID внутри. */
  newId?: () => string;
}

export interface Advice {
  suggestions: Suggestion[];
  /** Минимальный план: вернуться в дедлайн. */
  plan: RecoveryPlan | null;
  /** План с запасом (буфер ≥ LOW_BUFFER_DAYS), если он отличается от минимального. */
  safePlan: RecoveryPlan | null;
}

// --- Прогноз «Шанс успеть» ---

/**
 * Разброс длительности незавершённых задач — доли плана. Треугольное распределение с модой
 * «как в плане»: оценки обычно оптимистичны, поэтому хвост вправо длиннее.
 */
export interface Spread {
  optimistic: number;
  pessimistic: number;
  /** Для задач подрядчика и заблокированных задач. */
  riskyPessimistic: number;
}

export interface Forecast {
  runs: number;
  /** Доля прогонов, где проект укладывается в дедлайн (0…1). */
  chance: number;
  /** Доля прогонов, где проект заканчивается не позже плановой (детерминированной) даты. */
  planChance: number;
  p50: ISODate;
  p80: ISODate;
  p95: ISODate;
  /** Распределение даты финиша: index — исключающий конец, как `Analysis.finishIndex`. */
  histogram: { index: number; date: ISODate; count: number }[];
  /** В какой доле прогонов задача лежала на цепочке, определившей финиш. */
  drivers: { taskId: string; share: number }[];
}

// --- События «Что случилось?» ---

/** События из жизни проекта: руководитель описывает, что случилось, а не какие поля править. */
export type ProjectEvent =
  | {
      kind: 'absence';
      personId: string;
      from: ISODate;
      to: ISODate;
      /** Кому передать задачи на время отсутствия; null — задачи встают на паузу. */
      handoverTo: string | null;
    }
  | { kind: 'harder'; taskId: string; extraDays: number }
  | { kind: 'delay'; taskId: string; until: ISODate }
  | {
      kind: 'scope';
      name: string;
      durationDays: number;
      afterTaskId: string | null;
      beforeTaskId: string | null;
      assigneeId: string | null;
    }
  | { kind: 'deadline'; deadline: ISODate };

export type ProjectEventKind = ProjectEvent['kind'];

export interface CompiledEvent {
  ops: ChangeOp[];
  /** Короткое описание для причины изменения в журнале. */
  title: string;
}

// --- Шторм-тест ---

export interface Threat {
  id: string;
  kind: 'harder' | 'absence' | 'delay';
  title: string;
  detail: string;
  /** Главная задача сценария — для подсветки. */
  taskId: string | null;
  ops: ChangeOp[];
  /** Причина для журнала, если сценарий проиграть и применить. */
  reason: string;
  finishDelta: number;
  bufferAfter: number;
  breaksDeadline: boolean;
  /** Сколько новых серьёзных проблем (high-алертов) появится. */
  newProblems: number;
}

// --- Брифинг «Сообщить» ---

export interface TeamMessage {
  personId: string;
  name: string;
  text: string;
}

export interface BriefSection {
  title: string;
  lines: string[];
}

export interface Brief {
  subject: string;
  greeting: string;
  /** Письмо заказчику по разделам — для показа; `client` — то же одним текстом для копирования. */
  sections: BriefSection[];
  client: string;
  /** Коротко для мессенджера: 3–4 строки. */
  short: string;
  team: TeamMessage[];
}
