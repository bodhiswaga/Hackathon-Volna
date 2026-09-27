import type { ISODate } from './types';

/**
 * Календарь рабочих дней (пн–пт, без праздников).
 * Рабочий день кодируется абсолютным индексом: 0 — понедельник 1970-01-05.
 */

const DAY_MS = 86_400_000;
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);

export function parseDate(date: ISODate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatDate(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysSinceEpoch(date: ISODate): number {
  return Math.round((parseDate(date) - EPOCH_MONDAY) / DAY_MS);
}

/** Индекс рабочего дня для даты начала: выходной → следующий понедельник. */
export function startIndex(date: ISODate): number {
  const n = daysSinceEpoch(date);
  const week = Math.floor(n / 7);
  const dow = n - week * 7;
  return dow >= 5 ? (week + 1) * 5 : week * 5 + dow;
}

/** Исключающий конец для даты окончания (включительно): выходной → после пятницы. */
export function endIndex(date: ISODate): number {
  const n = daysSinceEpoch(date);
  const week = Math.floor(n / 7);
  const dow = n - week * 7;
  return dow >= 5 ? week * 5 + 5 : week * 5 + dow + 1;
}

/** Дата рабочего дня по индексу. */
export function indexToDate(index: number): ISODate {
  const week = Math.floor(index / 5);
  const d = index - week * 5;
  return formatDate(EPOCH_MONDAY + (week * 7 + d) * DAY_MS);
}

export function addCalendarDays(date: ISODate, days: number): ISODate {
  return formatDate(parseDate(date) + days * DAY_MS);
}

export function diffCalendarDays(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

export function isWeekend(date: ISODate): boolean {
  const dow = new Date(parseDate(date)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Сдвиг на n рабочих дней от даты (выходной считается следующим понедельником). */
export function addWorkdays(date: ISODate, n: number): ISODate {
  return indexToDate(startIndex(date) + n);
}

export function formatShort(date: ISODate): string {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

export function pluralDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'дней';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дня';
  return 'дней';
}

export function daysText(n: number): string {
  return `${n} раб. ${pluralDays(n)}`;
}
