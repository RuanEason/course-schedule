/**
 * Maps between calendar dates and `daily_class` indexes.
 *
 * Two orderings meet here and they do NOT agree:
 * - A schedule week window (`getScheduleWeekWindow`) runs Monday -> Sunday.
 * - `WEEKDAYS` / `config.daily_class` run Sunday -> Saturday.
 *
 * So `daily_class[0]` (Sunday) is the LAST day of the window and
 * `daily_class[1]` (Monday) is the FIRST. Every conversion goes through the
 * helpers below; do not re-derive the offset inline in components.
 */

/** `daily_class` index of Monday, given the Sunday-first `WEEKDAYS` order. */
export const MONDAY_DAY_INDEX = 1;

/** Offset from a Monday-first week position (0..6) to a `daily_class` index. */
function weekPositionToDayIndex(position: number): number {
  return (position + MONDAY_DAY_INDEX) % 7;
}

/** Offset from a `daily_class` index to a Monday-first week position (0..6). */
function dayIndexToWeekPosition(dayIndex: number): number {
  return (dayIndex - MONDAY_DAY_INDEX + 7) % 7;
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function isoDateFromUtc(value: Date): string {
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
    .map((part, index) => (index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0")))
    .join("-");
}

export function addDays(isoDate: string, days: number): string | null {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoDateFromUtc(parsed);
}

/**
 * Expands a Monday-based week start into the 7 dates it covers, Monday first.
 * Index 0 is Monday, index 6 is Sunday.
 */
export function getWeekDates(weekStart: string): string[] | null {
  if (!parseIsoDate(weekStart)) return null;
  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStart, offset);
    if (!date) return null;
    dates.push(date);
  }
  return dates;
}

/** Date for a `daily_class` index within the week that starts at `weekStart`. */
export function dateForDayIndex(weekStart: string, dayIndex: number): string | null {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return null;
  return addDays(weekStart, dayIndexToWeekPosition(dayIndex));
}

/** `daily_class` index of the day that falls on `isoDate` within `weekStart`'s week. */
export function dayIndexForDate(weekStart: string, isoDate: string): number | null {
  const start = parseIsoDate(weekStart);
  const target = parseIsoDate(isoDate);
  if (!start || !target) return null;
  const delta = Math.round((target.getTime() - start.getTime()) / 86_400_000);
  if (delta < 0 || delta > 6) return null;
  return weekPositionToDayIndex(delta);
}

export function isDateInWeek(weekStart: string, isoDate: string): boolean {
  return dayIndexForDate(weekStart, isoDate) !== null;
}

/** True for Saturday and Sunday, derived from the date itself rather than the index. */
export function isWeekendDate(isoDate: string): boolean {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return false;
  const day = parsed.getUTCDay();
  return day === 0 || day === 6;
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}
