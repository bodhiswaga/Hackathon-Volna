import {
  formatShort,
  parseDate,
  plural,
  pluralDays,
  type Health,
  type ISODate,
  type TaskFlags,
  type TaskStatus,
} from '@volna/engine';

export const HEALTH_TEXT: Record<Health, string> = {
  ok: 'Идёт по плану',
  attention: 'Нужно внимание',
  intervention: 'Требуется вмешательство',
};

export const HEALTH_COLOR: Record<Health, string> = {
  ok: 'var(--color-moss)',
  attention: 'var(--color-wave)',
  intervention: 'var(--color-crimson)',
};

const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** «30 окт» */
export function fmtDate(date: ISODate | null | undefined): string {
  if (!date) return '—';
  return formatShort(date);
}

/** «2 окт — 7 окт»; у вехи (начало = окончание) — одна дата. */
export function fmtRange(start: ISODate, end: ISODate, sep = ' — '): string {
  return start === end ? fmtDate(end) : `${fmtDate(start)}${sep}${fmtDate(end)}`;
}

export function fmtWeekday(date: ISODate): string {
  return weekday.format(new Date(parseDate(date))).replace('.', '');
}

export function fmtMonth(date: ISODate): string {
  return monthLong.format(new Date(parseDate(date)));
}

export function fmtDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** «3 дн.» / «+5 дн.» */
export function fmtDays(n: number, signed = false): string {
  const s = signed && n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n)} дн.`;
}

export function fmtDaysLong(n: number): string {
  return `${Math.abs(n)} раб. ${pluralDays(n)}`;
}

export function todayISO(): ISODate {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Не начата',
  in_progress: 'В работе',
  blocked: 'Заблокирована',
  done: 'Выполнена',
};

export const STATUS_SHORT: Record<TaskStatus, string> = {
  not_started: 'Не начата',
  in_progress: 'В работе',
  blocked: 'Блок',
  done: 'Готово',
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  not_started: 'var(--color-idle)',
  in_progress: 'var(--color-cobalt)',
  blocked: 'var(--color-ochre-bar)',
  done: 'var(--color-moss)',
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function newId(): string {
  return crypto.randomUUID();
}

/** «1 задача», «3 задачи», «5 задач». */
export function fmtTasks(n: number): string {
  return `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;
}

/** «сдвигается 1 зависимая задача», «сдвигаются 3 зависимые задачи». */
export function fmtShiftedTasks(n: number): string {
  return `${plural(n, 'сдвигается', 'сдвигаются', 'сдвигаются')} ${n} ${plural(n, 'зависимая задача', 'зависимые задачи', 'зависимых задач')}`;
}

/** «запас 3 дн.» / «опоздание 2 дн.» */
export function fmtBuffer(n: number): string {
  return n < 0 ? `опоздание ${fmtDays(-n)}` : `запас ${fmtDays(n)}`;
}

/** «78%» */
export function fmtChance(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Цвет вероятности: уверенно / на грани / вряд ли успеем. */
export function chanceTone(x: number): 'moss' | 'ochre' | 'crimson' {
  return x >= 0.8 ? 'moss' : x >= 0.5 ? 'ochre' : 'crimson';
}

/** Класс цвета текста для вероятности. */
export function chanceText(x: number): string {
  return { moss: 'text-moss', ochre: 'text-ochre', crimson: 'text-crimson' }[chanceTone(x)];
}

/**
 * Признаки риска задачи — одними словами во всех видах (таблица, редактор, подсказки).
 * Порядок — по важности; «блок» не нужен: это статус и он виден отдельно.
 */
export function riskLabels(f: TaskFlags): { text: string; tone: 'crimson' | 'wave' | 'ochre' }[] {
  const out: { text: string; tone: 'crimson' | 'wave' | 'ochre' }[] = [];
  if (f.pastDeadline) out.push({ text: 'За дедлайном', tone: 'crimson' });
  if (f.missesDueDate) out.push({ text: 'Не успевает к сроку', tone: 'crimson' });
  if (f.overdue) out.push({ text: 'Просрочена', tone: 'crimson' });
  if (f.critical) out.push({ text: 'Критический путь', tone: 'crimson' });
  if (f.overloaded) out.push({ text: 'Перегрузка', tone: 'wave' });
  if (f.lowFloat) out.push({ text: 'Мало резерва', tone: 'wave' });
  if (f.blockedByPredecessor) out.push({ text: 'Ждёт незавершённую', tone: 'ochre' });
  return out;
}
