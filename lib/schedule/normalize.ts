import { LEGACY_PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_NAME, type ScheduleConfig } from "./types";
import { ScheduleValidationError, validateScheduleConfig } from "./validation";

export interface NormalizationResult {
  config: ScheduleConfig;
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneUnknown(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeScheduleConfig(input: unknown): NormalizationResult {
  if (!isObject(input)) throw new ScheduleValidationError([{ path: "config", message: "配置必须是 JSON 对象" }]);

  const next = cloneUnknown(input) as Record<string, unknown>;
  const warnings: string[] = [];

  if (next.css_style === undefined) next.css_style = {};

  if (isObject(next.subject_name) && Object.prototype.hasOwnProperty.call(next.subject_name, LEGACY_PLACEHOLDER_SUBJECT_CODE)) {
    if (!Object.prototype.hasOwnProperty.call(next.subject_name, PLACEHOLDER_SUBJECT_CODE)) {
      next.subject_name[PLACEHOLDER_SUBJECT_CODE] = next.subject_name[LEGACY_PLACEHOLDER_SUBJECT_CODE] ?? PLACEHOLDER_SUBJECT_NAME;
    }
    delete next.subject_name[LEGACY_PLACEHOLDER_SUBJECT_CODE];
    warnings.push("已将旧占位课程代码 __UNASSIGNED__ 规范化为 TBD");
  }

  if (typeof next.countdown_target === "string" && next.countdown_target !== "hidden") {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(next.countdown_target);
    if (match) {
      const normalized = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
      if (normalized !== next.countdown_target) {
        warnings.push(`已将倒计时日期规范化为 ${normalized}`);
        next.countdown_target = normalized;
      }
    }
  }

  if (Array.isArray(next.daily_class)) {
    next.daily_class.forEach((day, dayIndex) => {
      if (!isObject(day) || !Array.isArray(day.classList)) return;
      day.classList = day.classList.map((course, classIndex) => {
        if (!Array.isArray(course)) return course === LEGACY_PLACEHOLDER_SUBJECT_CODE ? PLACEHOLDER_SUBJECT_CODE : course;
        if (course.length === 0) return course;
        if (course.length < 4) {
          const padded = [...course];
          while (padded.length < 4) padded.push(padded[padded.length - 1]);
          warnings.push(`星期 ${dayIndex} 的第 ${classIndex + 1} 节轮换课程只有 ${course.length} 项，已复制最后一项补齐第 4 周`);
          return padded.map((value) => value === LEGACY_PLACEHOLDER_SUBJECT_CODE ? PLACEHOLDER_SUBJECT_CODE : value);
        }
        if (course.length > 4) {
          warnings.push(`星期 ${dayIndex} 的第 ${classIndex + 1} 节轮换课程超过 4 项，已保留前 4 项`);
          return course.slice(0, 4).map((value) => value === LEGACY_PLACEHOLDER_SUBJECT_CODE ? PLACEHOLDER_SUBJECT_CODE : value);
        }
        return course.map((value) => value === LEGACY_PLACEHOLDER_SUBJECT_CODE ? PLACEHOLDER_SUBJECT_CODE : value);
      });
    });
  }

  const result = validateScheduleConfig(next);
  if (!result.success) throw new ScheduleValidationError(result.issues);
  return { config: result.data, warnings };
}
