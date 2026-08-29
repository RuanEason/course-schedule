import {
  cloneConfig,
  getCourseForWeek,
  PLACEHOLDER_SUBJECT_CODE,
  type CourseValue,
  type ScheduleAdjustmentPayload,
  type ScheduleConfig,
} from "./types";
import { validateScheduleConfig, type ValidationIssue } from "./validation";

export const SCHEDULE_TIME_ZONE = "Asia/Shanghai";

function datePartsInScheduleZone(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function isoDateFromUtc(value: Date): string {
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
    .join("-");
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
  return date;
}

export function getScheduleWeekWindow(now = new Date()): { start: string; end: string } {
  const parts = datePartsInScheduleZone(now);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayOfWeek = localDate.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const start = new Date(localDate);
  start.setUTCDate(start.getUTCDate() + mondayOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: isoDateFromUtc(start), end: isoDateFromUtc(end) };
}

export function formatScheduleDate(value: string): string {
  const parsed = parseIsoDate(value);
  if (!parsed) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SCHEDULE_TIME_ZONE,
    month: "numeric",
    day: "numeric",
  }).format(parsed);
}

export function isAdjustmentActive(adjustment: Pick<ScheduleAdjustmentPayload, "weekStart">, now = new Date()): boolean {
  return adjustment.weekStart === getScheduleWeekWindow(now).start;
}

export function parseScheduleAdjustment(value: unknown): ScheduleAdjustmentPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ScheduleAdjustmentPayload>;
  if (typeof candidate.weekStart !== "string" || !parseIsoDate(candidate.weekStart)) return null;
  const weekIndex = candidate.weekIndex;
  const sourceDraftVersion = candidate.sourceDraftVersion;
  if (typeof weekIndex !== "number" || !Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > 3) return null;
  if (typeof sourceDraftVersion !== "number" || !Number.isInteger(sourceDraftVersion) || sourceDraftVersion < 1) return null;
  const validation = validateScheduleConfig(candidate.config);
  if (!validation.success) return null;
  const changedCells = Array.isArray(candidate.changedCells)
    ? candidate.changedCells.filter((cell): cell is { dayIndex: number; classIndex: number } => (
      Boolean(cell)
      && typeof cell === "object"
      && Number.isInteger(cell.dayIndex)
      && cell.dayIndex >= 0
      && Number.isInteger(cell.classIndex)
      && cell.classIndex >= 0
    ))
    : [];
  return {
    weekStart: candidate.weekStart,
    weekIndex,
    sourceDraftVersion,
    config: validation.data,
    changedCells,
  };
}

export function mergeAdjustmentChangedCells(
  ...cellLists: Array<Array<{ dayIndex: number; classIndex: number }>>
): Array<{ dayIndex: number; classIndex: number }> {
  const cells = new Map<string, { dayIndex: number; classIndex: number }>();
  cellLists.flat().forEach((cell) => cells.set(`${cell.dayIndex}:${cell.classIndex}`, cell));
  return [...cells.values()].sort((a, b) => a.dayIndex - b.dayIndex || a.classIndex - b.classIndex);
}

export function validateAdjustmentConfig(
  baseConfig: ScheduleConfig,
  nextConfig: ScheduleConfig,
  weekIndex: number,
): { success: true } | { success: false; issues: ValidationIssue[] } {
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex > 3) {
    return { success: false, issues: [{ path: "weekIndex", message: "轮换周次必须是第 1 至第 4 周" }] };
  }

  const issues: ValidationIssue[] = [];
  const baseWithoutCourses = {
    countdown_target: baseConfig.countdown_target,
    week_display: baseConfig.week_display,
    subject_name: baseConfig.subject_name,
    timetable: baseConfig.timetable,
    divider: baseConfig.divider,
    css_style: baseConfig.css_style,
  };
  const nextWithoutCourses = {
    countdown_target: nextConfig.countdown_target,
    week_display: nextConfig.week_display,
    subject_name: nextConfig.subject_name,
    timetable: nextConfig.timetable,
    divider: nextConfig.divider,
    css_style: nextConfig.css_style,
  };

  if (JSON.stringify(baseWithoutCourses) !== JSON.stringify(nextWithoutCourses)) {
    issues.push({ path: "config", message: "调课模式只能修改课程安排，不能修改模板、课程库或客户端样式" });
  }
  if (baseConfig.daily_class.length !== nextConfig.daily_class.length) {
    issues.push({ path: "daily_class", message: "调课不能修改星期或课程槽数量" });
  }

  for (let dayIndex = 0; dayIndex < baseConfig.daily_class.length; dayIndex += 1) {
    const baseDay = baseConfig.daily_class[dayIndex];
    const nextDay = nextConfig.daily_class[dayIndex];
    if (!baseDay || !nextDay) continue;
    if (baseDay.Chinese !== nextDay.Chinese || baseDay.English !== nextDay.English || baseDay.timetable !== nextDay.timetable) {
      issues.push({ path: `daily_class.${dayIndex}`, message: "调课不能修改星期或日程模板" });
    }
    if (baseDay.classList.length !== nextDay.classList.length) {
      issues.push({ path: `daily_class.${dayIndex}.classList`, message: "调课不能修改课程槽数量" });
      continue;
    }
    for (let classIndex = 0; classIndex < baseDay.classList.length; classIndex += 1) {
      const baseValue = baseDay.classList[classIndex];
      const nextValue = nextDay.classList[classIndex];
      for (let candidateWeek = 0; candidateWeek < 4; candidateWeek += 1) {
        if (candidateWeek === weekIndex) continue;
        if (getCourseForWeek(baseValue, candidateWeek) !== getCourseForWeek(nextValue, candidateWeek)) {
          issues.push({
            path: `daily_class.${dayIndex}.classList.${classIndex}`,
            message: `只能修改第 ${weekIndex + 1} 周的课程安排`,
          });
          break;
        }
      }
    }
  }

  return issues.length ? { success: false, issues } : { success: true };
}

export function getAdjustmentChangedCells(
  baseConfig: ScheduleConfig,
  adjustmentConfig: ScheduleConfig,
  weekIndex: number,
): Array<{ dayIndex: number; classIndex: number }> {
  const changedCells: Array<{ dayIndex: number; classIndex: number }> = [];
  const dayCount = Math.min(baseConfig.daily_class.length, adjustmentConfig.daily_class.length);
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const baseDay = baseConfig.daily_class[dayIndex];
    const adjustmentDay = adjustmentConfig.daily_class[dayIndex];
    if (!baseDay || !adjustmentDay) continue;
    const classCount = Math.min(baseDay.classList.length, adjustmentDay.classList.length);
    for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
      if (getCourseForWeek(baseDay.classList[classIndex], weekIndex) !== getCourseForWeek(adjustmentDay.classList[classIndex], weekIndex)) {
        changedCells.push({ dayIndex, classIndex });
      }
    }
  }
  return changedCells;
}

export function setAdjustmentCourseForWeek(value: CourseValue | undefined, weekIndex: number, code: string): CourseValue {
  if (!Array.isArray(value) && value === code) return value;
  const next = Array.isArray(value) ? [...value] : Array.from({ length: 4 }, () => value ?? PLACEHOLDER_SUBJECT_CODE);
  while (next.length < 4) next.push(next[next.length - 1] ?? PLACEHOLDER_SUBJECT_CODE);
  next[weekIndex] = code;
  return next;
}

export function setAdjustmentCourse(
  config: ScheduleConfig,
  dayIndex: number,
  classIndex: number,
  weekIndex: number,
  code: string,
): ScheduleConfig {
  const next = cloneConfig(config);
  const day = next.daily_class[dayIndex];
  if (!day) return next;
  day.classList[classIndex] = setAdjustmentCourseForWeek(day.classList[classIndex], weekIndex, code);
  return next;
}

export function swapAdjustmentCourses(
  config: ScheduleConfig,
  sourceDayIndex: number,
  sourceClassIndex: number,
  targetDayIndex: number,
  targetClassIndex: number,
  weekIndex: number,
): ScheduleConfig {
  const next = cloneConfig(config);
  const sourceDay = next.daily_class[sourceDayIndex];
  const targetDay = next.daily_class[targetDayIndex];
  if (!sourceDay || !targetDay) return next;
  const sourceValue = getCourseForWeek(sourceDay.classList[sourceClassIndex], weekIndex);
  const targetValue = getCourseForWeek(targetDay.classList[targetClassIndex], weekIndex);
  sourceDay.classList[sourceClassIndex] = setAdjustmentCourseForWeek(sourceDay.classList[sourceClassIndex], weekIndex, targetValue);
  targetDay.classList[targetClassIndex] = setAdjustmentCourseForWeek(targetDay.classList[targetClassIndex], weekIndex, sourceValue);
  return next;
}

export function getEffectiveScheduleConfig(
  publishedConfig: ScheduleConfig,
  adjustment: ScheduleAdjustmentPayload | null,
  now = new Date(),
): ScheduleConfig {
  if (!adjustment || !isAdjustmentActive(adjustment, now)) return publishedConfig;
  const validation = validateScheduleConfig(adjustment.config);
  if (!validation.success) return publishedConfig;
  const next = cloneConfig(validation.data);
  next.daily_class = next.daily_class.map((day) => ({
    ...day,
    classList: day.classList.map((value) => getCourseForWeek(value, adjustment.weekIndex)),
  }));
  return next;
}
