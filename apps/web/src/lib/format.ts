import { formatShort, parseDate, plural, pluralDays, type Health, type ISODate, type TaskStatus } from '@volna/engine';

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
  blocked: 'var(--color-ochre)',
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
