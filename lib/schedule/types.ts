export type CourseValue = string | string[];
export type TimetableValue = number | string;

/** A single day deviating from the weekly pattern; see `date-override.ts`. */
export interface ScheduleDayOverride {
  date: string;
  template?: string;
  sourceDayIndex?: number;
  label?: string;
}

export interface DailyClass {
  Chinese: string;
  English: string;
  timetable: string;
  classList: CourseValue[];
}

export interface ScheduleConfig {
  countdown_target: string;
  week_display: boolean;
  subject_name: Record<string, string>;
  timetable: Record<string, Record<string, TimetableValue>>;
  divider: Record<string, number[]>;
  daily_class: DailyClass[];
  css_style: Record<string, string>;
}

export interface ScheduleWeekWindow {
  start: string;
  end: string;
}

export interface ScheduleAdjustmentPayload {
  weekStart: string;
  weekIndex: number;
  sourceDraftVersion: number;
  config: ScheduleConfig;
  changedCells: Array<{ dayIndex: number; classIndex: number }>;
  /** Date-level overrides, e.g. a weekend running Monday's lessons. */
  dayOverrides?: ScheduleDayOverride[];
}

export type ScheduleAdjustmentStatus = "draft" | "active";

export interface ScheduleAdjustmentView extends ScheduleAdjustmentPayload {
  version: number;
  status: ScheduleAdjustmentStatus;
  publishedAt: string | null;
  updatedAt: string;
}

export interface ScheduleDocumentView {
  draftConfig: ScheduleConfig;
  publishedConfig: ScheduleConfig;
  previousPublishedConfig: ScheduleConfig | null;
  draftVersion: number;
  publishedVersion: number;
  publishedAt: string | null;
  draftUpdatedAt: string;
  updatedAt: string;
  currentWeek: ScheduleWeekWindow;
  temporaryAdjustment: ScheduleAdjustmentView | null;
  temporaryAdjustmentVersion: number;
  temporaryAdjustmentUpdatedAt: string | null;
}

export type ScheduleRevisionSource = "checkpoint" | "publish" | "restore";

export interface ScheduleRevisionView {
  id: number;
  draftVersion: number;
  publishedVersion: number | null;
  source: ScheduleRevisionSource;
  note: string | null;
  createdAt: string;
}

export interface TemplateRowDraft {
  timeRange: string;
  kind: "class" | "event";
  eventLabel?: string;
  sourceClassIndex?: number;
  divider?: boolean;
}

export interface TemplateRow extends TemplateRowDraft {
  classIndex?: number;
}

export const WEEKDAYS = [
  { Chinese: "日", English: "SUN" },
  { Chinese: "一", English: "MON" },
  { Chinese: "二", English: "TUE" },
  { Chinese: "三", English: "WED" },
  { Chinese: "四", English: "THR" },
  { Chinese: "五", English: "FRI" },
  { Chinese: "六", English: "SAT" },
] as const;

export const PLACEHOLDER_SUBJECT_CODE = "TBD";
export const LEGACY_PLACEHOLDER_SUBJECT_CODE = "__UNASSIGNED__";
export const PLACEHOLDER_SUBJECT_NAME = "待安排";

export function isRotatingCourse(value: CourseValue): value is string[] {
  return Array.isArray(value);
}

/**
 * True only when the four weeks actually differ.
 *
 * Any array-shaped value used to raise the "4W" badge, but an ordinary
 * temporary adjustment converts a plain course into `["TBD","TBD","EN","TBD"]`.
 * That is a one-week difference, not a rotation, and badging every adjusted
 * cell trained users to ignore the mark entirely.
 */
export function isMeaningfullyRotating(value: CourseValue | undefined): boolean {
  if (!Array.isArray(value)) return false;
  return new Set(value).size > 1;
}

export function getCourseForWeek(value: CourseValue | undefined, weekIndex: number): string {
  if (value === undefined) return PLACEHOLDER_SUBJECT_CODE;
  if (!Array.isArray(value)) return value;
  return value[weekIndex] ?? value[value.length - 1] ?? PLACEHOLDER_SUBJECT_CODE;
}

export function setCourseForWeek(value: CourseValue | undefined, weekIndex: number, code: string): CourseValue {
  if (!Array.isArray(value)) return code;
  const next = [...value];
  while (next.length < 4) next.push(next[next.length - 1] ?? PLACEHOLDER_SUBJECT_CODE);
  next[weekIndex] = code;
  return next;
}

export function cloneConfig(config: ScheduleConfig): ScheduleConfig {
  return JSON.parse(JSON.stringify(config)) as ScheduleConfig;
}
