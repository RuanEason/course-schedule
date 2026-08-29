import { z } from "zod";

import type { ScheduleConfig } from "./types";

const timeRangePattern = /^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/;

function isValidCountdownDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const courseValueSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(4)]);

const dailyClassSchema = z.object({
  Chinese: z.string(),
  English: z.string(),
  timetable: z.string().min(1),
  classList: z.array(courseValueSchema),
});

export const scheduleConfigSchema = z
  .object({
    countdown_target: z.string().refine(
      (value) => value === "hidden" || isValidCountdownDate(value),
      "倒计时日期必须是 YYYY-MM-DD，或填写 hidden",
    ),
    week_display: z.boolean(),
    subject_name: z.record(z.string(), z.string().min(1)),
    timetable: z.record(z.string(), z.record(z.string(), z.union([z.number().int().nonnegative(), z.string()]))),
    divider: z.record(z.string(), z.array(z.number().int().nonnegative())),
    daily_class: z.array(dailyClassSchema).length(7),
    css_style: z.record(z.string(), z.string()),
  })
  .superRefine((config, ctx) => {
    const timetableNames = Object.keys(config.timetable);
    const dividerNames = Object.keys(config.divider);

    for (const name of timetableNames) {
      if (!Object.prototype.hasOwnProperty.call(config.divider, name)) {
        ctx.addIssue({ code: "custom", path: ["divider", name], message: `缺少日程模板 ${name} 的分隔线配置` });
      }
    }
    for (const name of dividerNames) {
      if (!Object.prototype.hasOwnProperty.call(config.timetable, name)) {
        ctx.addIssue({ code: "custom", path: ["divider", name], message: `分隔线引用了不存在的日程模板 ${name}` });
      }
    }

    const maxCourseIndexes = new Map<string, number>();
    for (const [templateName, timetable] of Object.entries(config.timetable)) {
      let previousEnd = -1;
      const courseIndexes: number[] = [];

      for (const [timeRange, value] of Object.entries(timetable)) {
        const parsed = parseTimeRange(timeRange);
        if (!parsed) {
          ctx.addIssue({ code: "custom", path: ["timetable", templateName, timeRange], message: "时间段必须使用 HH:MM-HH:MM 格式" });
          continue;
        }

        if (parsed.start >= parsed.end) {
          ctx.addIssue({ code: "custom", path: ["timetable", templateName, timeRange], message: "时间段的开始时间必须早于结束时间" });
        }
        if (parsed.start <= previousEnd) {
          ctx.addIssue({ code: "custom", path: ["timetable", templateName, timeRange], message: "时间段不能重叠，且对象顺序必须按时间排列" });
        }
        previousEnd = parsed.end;

        if (typeof value === "number") courseIndexes.push(value);
      }

      const maxIndex = courseIndexes.length ? Math.max(...courseIndexes) : -1;
      maxCourseIndexes.set(templateName, maxIndex);
      const uniqueIndexes = [...new Set(courseIndexes)].sort((a, b) => a - b);
      if (uniqueIndexes.length !== courseIndexes.length) {
        ctx.addIssue({ code: "custom", path: ["timetable", templateName], message: "课程索引不能重复" });
      }
      uniqueIndexes.forEach((index, position) => {
        if (index !== position) {
          ctx.addIssue({ code: "custom", path: ["timetable", templateName], message: "课程索引必须从 0 开始连续排列" });
        }
      });

      const divider = config.divider[templateName] ?? [];
      divider.forEach((index, position) => {
        if (index > maxIndex) {
          ctx.addIssue({ code: "custom", path: ["divider", templateName, position], message: "分隔线索引超出了课程数量" });
        }
      });
    }

    config.daily_class.forEach((day, dayIndex) => {
      const maxIndex = maxCourseIndexes.get(day.timetable);
      if (maxIndex === undefined) {
        ctx.addIssue({ code: "custom", path: ["daily_class", dayIndex, "timetable"], message: `引用了不存在的日程模板 ${day.timetable}` });
        return;
      }
      if (day.classList.length <= maxIndex) {
        ctx.addIssue({ code: "custom", path: ["daily_class", dayIndex, "classList"], message: `课程列表至少需要覆盖到第 ${maxIndex + 1} 个课程索引` });
      }

      day.classList.forEach((value, classIndex) => {
        const values = Array.isArray(value) ? value : [value];
        if (Array.isArray(value) && value.length < 4) {
          ctx.addIssue({ code: "custom", path: ["daily_class", dayIndex, "classList", classIndex], message: "四周轮换课程必须至少提供 4 项" });
        }
        values.forEach((code, valueIndex) => {
          if (!Object.prototype.hasOwnProperty.call(config.subject_name, code)) {
            ctx.addIssue({
              code: "custom",
              path: ["daily_class", dayIndex, "classList", classIndex, valueIndex],
              message: `课程代码 ${code} 不存在于 subject_name`,
            });
          }
        });
      });
    });

    Object.entries(config.css_style).forEach(([key, value]) => {
      if (!/^--[a-zA-Z0-9_-]+$/.test(key)) {
        ctx.addIssue({ code: "custom", path: ["css_style", key], message: "CSS 自定义属性必须以 -- 开头" });
      }
      if (value.length > 2000) {
        ctx.addIssue({ code: "custom", path: ["css_style", key], message: "CSS 自定义属性值不能超过 2000 个字符" });
      }
    });
  });

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateScheduleConfig(config: unknown): { success: true; data: ScheduleConfig } | { success: false; issues: ValidationIssue[] } {
  const result = scheduleConfigSchema.safeParse(config);
  if (result.success) return { success: true, data: result.data as ScheduleConfig };
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.map(String).join(".") : "config",
      message: issue.message,
    })),
  };
}

export class ScheduleValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super("课表配置校验失败");
    this.name = "ScheduleValidationError";
  }
}

export function parseTimeRange(value: string): { start: number; end: number } | null {
  if (!timeRangePattern.test(value)) return null;
  const [startText, endText] = value.split("-");
  return { start: timeToMinutes(startText), end: timeToMinutes(endText) };
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
