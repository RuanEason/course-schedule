import {
  PLACEHOLDER_SUBJECT_CODE,
  cloneConfig,
  getCourseForWeek,
  type CourseValue,
  type ScheduleConfig,
  type ScheduleDayOverride,
} from "./types";
import { getClassRows } from "./editor-operations";
import { dayIndexForDate, isDateInWeek, isValidIsoDate } from "./week-dates";

export type { ScheduleDayOverride };

export interface ResolvedDaySchedule {
  template: string;
  classList: CourseValue[];
  /** Slots the source day could not fill and that fell back to the placeholder. */
  placeholderCount: number;
  label: string | null;
  sourceDayIndex: number | null;
}

/**
 * Reads the lessons a template needs, taking them from `sourceDayIndex`.
 *
 * Unlike `assignDayTemplate`, which reuses whatever the target day already
 * held, this pulls from the source day and pads the missing slots. That is the
 * whole point of a make-up day: a 2-slot weekend must be able to receive
 * Monday's 3 lessons instead of becoming a column of TBD.
 */
export function getClassesForTemplateFromDay(
  config: ScheduleConfig,
  sourceDayIndex: number,
  templateName: string,
  weekIndex: number,
): { classList: CourseValue[]; placeholderCount: number } {
  const classCount = getClassRows(config, templateName).length;
  const sourceList = config.daily_class[sourceDayIndex]?.classList ?? [];
  const classList: CourseValue[] = [];
  let placeholderCount = 0;

  for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
    const value = sourceList[classIndex];
    if (value === undefined) {
      classList.push(PLACEHOLDER_SUBJECT_CODE);
      placeholderCount += 1;
      continue;
    }
    // Keep only the active rotation week so a make-up day never inherits a
    // stale four-week array it has no business carrying.
    const code = getCourseForWeek(value, weekIndex);
    classList.push(code === PLACEHOLDER_SUBJECT_CODE ? PLACEHOLDER_SUBJECT_CODE : code);
  }

  return { classList, placeholderCount };
}

export function describeOverrideLabel(sourceDayIndex: number, chineseWeekday: string): string {
  return `补周${chineseWeekday}的课`;
}

/**
 * Builds the override that turns `date` into a copy of `sourceDayIndex`.
 * Returns null when either side is unusable, so callers can surface a message.
 */
export function buildOverrideFromCopyDay(
  config: ScheduleConfig,
  weekStart: string,
  date: string,
  sourceDayIndex: number,
  label?: string,
): ScheduleDayOverride | null {
  if (!isDateInWeek(weekStart, date)) return null;
  if (!Number.isInteger(sourceDayIndex) || sourceDayIndex < 0 || sourceDayIndex > 6) return null;
  const source = config.daily_class[sourceDayIndex];
  if (!source) return null;
  return {
    date,
    template: source.timetable,
    sourceDayIndex,
    ...(label ? { label } : {}),
  };
}

export function findOverride(
  overrides: readonly ScheduleDayOverride[] | undefined,
  date: string,
): ScheduleDayOverride | null {
  if (!overrides?.length) return null;
  return overrides.find((override) => override.date === date) ?? null;
}

/**
 * Resolves the lessons that should actually run on `date`.
 * Returns null when no override applies, meaning the normal weekly pattern stands.
 */
export function resolveDateSchedule(
  config: ScheduleConfig,
  overrides: readonly ScheduleDayOverride[] | undefined,
  weekStart: string,
  date: string,
  weekIndex: number,
): ResolvedDaySchedule | null {
  const override = findOverride(overrides, date);
  if (!override) return null;
  if (!isDateInWeek(weekStart, date)) return null;

  const ownDayIndex = dayIndexForDate(weekStart, date);
  if (ownDayIndex === null) return null;

  const sourceDayIndex = override.sourceDayIndex ?? ownDayIndex;
  const targetTemplate = override.template ?? config.daily_class[sourceDayIndex]?.timetable;
  if (!targetTemplate || !config.timetable[targetTemplate]) return null;

  const { classList, placeholderCount } = getClassesForTemplateFromDay(
    config,
    sourceDayIndex,
    targetTemplate,
    weekIndex,
  );

  return {
    template: targetTemplate,
    classList,
    placeholderCount,
    label: override.label ?? null,
    sourceDayIndex: override.sourceDayIndex ?? null,
  };
}

/**
 * Applies every override that lands inside the week to a copy of the config,
 * rewriting the matching `daily_class` entries. Used by read paths that render
 * a concrete week (the public viewer and `/config.json`).
 */
export function applyDayOverrides(
  config: ScheduleConfig,
  overrides: readonly ScheduleDayOverride[] | undefined,
  weekStart: string,
  weekIndex: number,
): ScheduleConfig {
  if (!overrides?.length) return config;
  const next = cloneConfig(config);
  let touched = false;

  for (const override of overrides) {
    const resolved = resolveDateSchedule(config, [override], weekStart, override.date, weekIndex);
    if (!resolved) continue;
    const dayIndex = dayIndexForDate(weekStart, override.date);
    if (dayIndex === null) continue;
    const day = next.daily_class[dayIndex];
    if (!day) continue;
    day.timetable = resolved.template;
    day.classList = resolved.classList.map((value) => (Array.isArray(value) ? [...value] : value));
    touched = true;
  }

  return touched ? next : config;
}

export interface DayOverrideIssue {
  path: string;
  message: string;
}

export function validateDayOverrides(
  overrides: unknown,
  config: ScheduleConfig,
  weekStart: string,
): { success: true; data: ScheduleDayOverride[] } | { success: false; issues: DayOverrideIssue[] } {
  if (overrides === undefined || overrides === null) return { success: true, data: [] };
  if (!Array.isArray(overrides)) {
    return { success: false, issues: [{ path: "dayOverrides", message: "补课设置必须是数组" }] };
  }

  const issues: DayOverrideIssue[] = [];
  const seen = new Set<string>();
  const data: ScheduleDayOverride[] = [];

  overrides.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      issues.push({ path: `dayOverrides.${index}`, message: "补课设置必须是一个对象" });
      return;
    }
    const candidate = entry as Partial<ScheduleDayOverride>;
    if (typeof candidate.date !== "string" || !isValidIsoDate(candidate.date)) {
      issues.push({ path: `dayOverrides.${index}.date`, message: "补课日期必须是 YYYY-MM-DD" });
      return;
    }
    if (!isDateInWeek(weekStart, candidate.date)) {
      issues.push({ path: `dayOverrides.${index}.date`, message: `补课日期 ${candidate.date} 不在本周范围内` });
      return;
    }
    if (seen.has(candidate.date)) {
      issues.push({ path: `dayOverrides.${index}.date`, message: `${candidate.date} 重复设置了补课` });
      return;
    }

    if (candidate.sourceDayIndex !== undefined) {
      if (
        !Number.isInteger(candidate.sourceDayIndex)
        || (candidate.sourceDayIndex as number) < 0
        || (candidate.sourceDayIndex as number) > 6
      ) {
        issues.push({ path: `dayOverrides.${index}.sourceDayIndex`, message: "课程来源必须是 0 到 6 之间的星期序号" });
        return;
      }
    }
    if (candidate.template !== undefined) {
      if (typeof candidate.template !== "string" || !config.timetable[candidate.template]) {
        issues.push({ path: `dayOverrides.${index}.template`, message: `日程模板 ${String(candidate.template)} 不存在` });
        return;
      }
    }
    if (candidate.label !== undefined && typeof candidate.label !== "string") {
      issues.push({ path: `dayOverrides.${index}.label`, message: "补课备注必须是文本" });
      return;
    }

    seen.add(candidate.date);
    data.push({
      date: candidate.date,
      ...(candidate.template !== undefined ? { template: candidate.template } : {}),
      ...(candidate.sourceDayIndex !== undefined ? { sourceDayIndex: candidate.sourceDayIndex } : {}),
      ...(candidate.label !== undefined ? { label: candidate.label } : {}),
    });
  });

  return issues.length ? { success: false, issues } : { success: true, data };
}

/** Same date set, order-insensitive --- used to decide whether an edit is real. */
export function dayOverridesEqual(
  a: readonly ScheduleDayOverride[] | undefined,
  b: readonly ScheduleDayOverride[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const normalize = (list: readonly ScheduleDayOverride[]) => [...list]
    .map((item) => `${item.date}|${item.template ?? ""}|${item.sourceDayIndex ?? ""}|${item.label ?? ""}`)
    .sort();
  const leftKeys = normalize(left);
  const rightKeys = normalize(right);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

/** Replaces (or removes) the override for one date, returning a new list. */
export function setDayOverride(
  overrides: readonly ScheduleDayOverride[] | undefined,
  override: ScheduleDayOverride | null,
  date: string,
): ScheduleDayOverride[] {
  const rest = (overrides ?? []).filter((item) => item.date !== date);
  return override ? [...rest, override].sort((a, b) => a.date.localeCompare(b.date)) : rest;
}
