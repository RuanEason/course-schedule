import {
  getTemplateRows,
  rebuildTemplate,
} from "./editor-operations";
import { parseTimeRange, timeToMinutes } from "./validation";
import type { ScheduleConfig, TemplateRow, TemplateRowDraft } from "./types";

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_BREAK_LABEL = "课间";

export interface AutoArrangeOptions {
  startTime: string;
  classCount: number;
  classDurationMinutes: number;
  breakDurationMinutes: number;
  breakLabel: string;
  dividerAfterBlock: boolean;
}

export interface AutoArrangeResult {
  rows: TemplateRowDraft[];
  startMinutes: number;
  endMinutes: number;
}

export interface AutoArrangePreview extends AutoArrangeResult {
  replacedRows: TemplateRow[];
  preservedCourseCount: number;
  discardedCourseCount: number;
  addedPlaceholderCount: number;
}

export class AutoArrangeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoArrangeValidationError";
  }
}

function isValidTime(value: string): boolean {
  return timePattern.test(value);
}

function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatTimeRange(startMinutes: number, endMinutes: number): string {
  return `${formatTime(startMinutes)}-${formatTime(endMinutes - 1)}`;
}

function validateOptions(options: AutoArrangeOptions): void {
  if (!isValidTime(options.startTime)) {
    throw new AutoArrangeValidationError("开始时间必须使用 HH:MM 格式");
  }
  if (!Number.isInteger(options.classCount) || options.classCount < 1) {
    throw new AutoArrangeValidationError("连续课程节数必须是大于 0 的整数");
  }
  if (!Number.isInteger(options.classDurationMinutes) || options.classDurationMinutes < 1) {
    throw new AutoArrangeValidationError("课程时长必须是大于 0 的整数分钟");
  }
  if (!Number.isInteger(options.breakDurationMinutes) || options.breakDurationMinutes < 0) {
    throw new AutoArrangeValidationError("课间时长必须是大于等于 0 的整数分钟");
  }

  const startMinutes = timeToMinutes(options.startTime);
  const totalMinutes = options.classCount * options.classDurationMinutes + (options.classCount - 1) * options.breakDurationMinutes;
  if (startMinutes + totalMinutes > 24 * 60) {
    throw new AutoArrangeValidationError("生成时间段不能超过当天 23:59");
  }
}

function rowBounds(timeRange: string): { start: number; end: number } | null {
  const parsed = parseTimeRange(timeRange);
  if (!parsed) return null;
  return { start: parsed.start, end: parsed.end + 1 };
}

function overlapsBlock(timeRange: string, startMinutes: number, endMinutes: number): boolean {
  const bounds = rowBounds(timeRange);
  if (!bounds) return false;
  return bounds.start < endMinutes && startMinutes < bounds.end;
}

export function generateAutoArrangeRows(options: AutoArrangeOptions): AutoArrangeResult {
  validateOptions(options);

  const startMinutes = timeToMinutes(options.startTime);
  const rows: TemplateRowDraft[] = [];
  const breakLabel = options.breakLabel.trim() || DEFAULT_BREAK_LABEL;
  let cursor = startMinutes;

  for (let index = 0; index < options.classCount; index += 1) {
    const classEnd = cursor + options.classDurationMinutes;
    rows.push({
      timeRange: formatTimeRange(cursor, classEnd),
      kind: "class",
      divider: index === options.classCount - 1 && options.dividerAfterBlock,
    });
    cursor = classEnd;

    if (index < options.classCount - 1 && options.breakDurationMinutes > 0) {
      const breakEnd = cursor + options.breakDurationMinutes;
      rows.push({
        timeRange: formatTimeRange(cursor, breakEnd),
        kind: "event",
        eventLabel: breakLabel,
      });
      cursor = breakEnd;
    }
  }

  return { rows, startMinutes, endMinutes: cursor };
}

export function previewAutoArrange(config: ScheduleConfig, templateName: string, options: AutoArrangeOptions): AutoArrangePreview {
  const generated = generateAutoArrangeRows(options);
  const existingRows = getTemplateRows(config, templateName);
  const replacedRows = existingRows.filter((row) => overlapsBlock(row.timeRange, generated.startMinutes, generated.endMinutes));
  const replacedClassCount = replacedRows.filter((row) => row.kind === "class").length;
  const generatedClassCount = generated.rows.filter((row) => row.kind === "class").length;

  return {
    ...generated,
    replacedRows,
    preservedCourseCount: Math.min(replacedClassCount, generatedClassCount),
    discardedCourseCount: Math.max(0, replacedClassCount - generatedClassCount),
    addedPlaceholderCount: Math.max(0, generatedClassCount - replacedClassCount),
  };
}

export function applyAutoArrange(
  config: ScheduleConfig,
  templateName: string,
  options: AutoArrangeOptions,
  placeholderCode: string,
): ScheduleConfig {
  const preview = previewAutoArrange(config, templateName, options);
  const existingRows = getTemplateRows(config, templateName);
  const replacedClassRows = preview.replacedRows.filter((row) => row.kind === "class");
  let replacedClassIndex = 0;

  const generatedRows = preview.rows.map((row) => {
    if (row.kind !== "class") return row;
    const source = replacedClassRows[replacedClassIndex];
    replacedClassIndex += 1;
    return source?.sourceClassIndex === undefined ? row : { ...row, sourceClassIndex: source.sourceClassIndex };
  });
  const remainingRows = existingRows.filter((row) => !overlapsBlock(row.timeRange, preview.startMinutes, preview.endMinutes));

  return rebuildTemplate(config, templateName, [...remainingRows, ...generatedRows], placeholderCode);
}
