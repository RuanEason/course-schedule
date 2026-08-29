import {
  getCourseForWeek,
  PLACEHOLDER_SUBJECT_CODE,
  PLACEHOLDER_SUBJECT_NAME,
  WEEKDAYS,
  type CourseValue,
  type ScheduleConfig,
} from "./types";
import { parseSubjectCode } from "./subject-code";

export type ScheduleDiffCategory = "课程安排" | "时间模板" | "课程库" | "客户端设置";

export interface ScheduleDiffItem {
  id: string;
  category: ScheduleDiffCategory;
  label: string;
  detail: string;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function courseName(config: ScheduleConfig, code: string): string {
  if (code === PLACEHOLDER_SUBJECT_CODE) return PLACEHOLDER_SUBJECT_NAME;
  const primaryCode = parseSubjectCode(code).primary;
  return config.subject_name[code] ?? config.subject_name[primaryCode] ?? code;
}

function formatCourseValue(config: ScheduleConfig, value: CourseValue | undefined): string {
  if (value === undefined) return PLACEHOLDER_SUBJECT_NAME;
  if (!Array.isArray(value)) return courseName(config, value);
  return value.map((code) => courseName(config, code)).join(" / ");
}

function formatWeekChanges(
  draft: ScheduleConfig,
  published: ScheduleConfig,
  draftValue: CourseValue | undefined,
  publishedValue: CourseValue | undefined,
): string {
  const changes: string[] = [];
  for (let weekIndex = 0; weekIndex < 4; weekIndex += 1) {
    const from = getCourseForWeek(publishedValue, weekIndex);
    const to = getCourseForWeek(draftValue, weekIndex);
    if (from !== to) changes.push(`第 ${weekIndex + 1} 周 ${courseName(published, from)} → ${courseName(draft, to)}`);
  }
  return changes.join("；");
}

function addRecordChanges(
  items: ScheduleDiffItem[],
  category: ScheduleDiffCategory,
  idPrefix: string,
  draft: Record<string, unknown>,
  published: Record<string, unknown>,
  labelForKey: (key: string) => string,
) {
  const keys = new Set([...Object.keys(draft), ...Object.keys(published)]);
  for (const key of keys) {
    if (sameValue(draft[key], published[key])) continue;
    const from = published[key] === undefined ? "未设置" : String(published[key]);
    const to = draft[key] === undefined ? "未设置" : String(draft[key]);
    items.push({
      id: `${idPrefix}:${key}`,
      category,
      label: labelForKey(key),
      detail: `${from} → ${to}`,
    });
  }
}

export function diffScheduleConfigs(draft: ScheduleConfig, published: ScheduleConfig): ScheduleDiffItem[] {
  const items: ScheduleDiffItem[] = [];
  const dayCount = Math.max(draft.daily_class.length, published.daily_class.length);

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const draftDay = draft.daily_class[dayIndex];
    const publishedDay = published.daily_class[dayIndex];
    const dayLabel = WEEKDAYS[dayIndex]?.Chinese ?? `第 ${dayIndex + 1} 天`;
    const classCount = Math.max(draftDay?.classList.length ?? 0, publishedDay?.classList.length ?? 0);
    for (let classIndex = 0; classIndex < classCount; classIndex += 1) {
      const draftValue = draftDay?.classList[classIndex];
      const publishedValue = publishedDay?.classList[classIndex];
      if (sameValue(draftValue, publishedValue)) continue;
      const detail = formatWeekChanges(draft, published, draftValue, publishedValue)
        || `${formatCourseValue(published, publishedValue)} → ${formatCourseValue(draft, draftValue)}`;
      items.push({
        id: `course:${dayIndex}:${classIndex}`,
        category: "课程安排",
        label: `周${dayLabel} 第 ${classIndex + 1} 节`,
        detail,
      });
    }

    if (draftDay?.timetable !== publishedDay?.timetable) {
      items.push({
        id: `day-template:${dayIndex}`,
        category: "时间模板",
        label: `周${dayLabel} 使用的模板`,
        detail: `${publishedDay?.timetable ?? "未设置"} → ${draftDay?.timetable ?? "未设置"}`,
      });
    }
  }

  const templateNames = new Set([...Object.keys(draft.timetable), ...Object.keys(published.timetable)]);
  for (const templateName of templateNames) {
    const timetableChanged = !sameValue(draft.timetable[templateName], published.timetable[templateName]);
    const dividerChanged = !sameValue(draft.divider[templateName], published.divider[templateName]);
    if (!timetableChanged && !dividerChanged) continue;
    const changedParts = [timetableChanged ? "时间段" : "", dividerChanged ? "分隔线" : ""].filter(Boolean).join("、");
    items.push({
      id: `template:${templateName}`,
      category: "时间模板",
      label: templateName,
      detail: `${changedParts}有变化`,
    });
  }

  addRecordChanges(
    items,
    "课程库",
    "subject",
    draft.subject_name,
    published.subject_name,
    (key) => `课程 ${key}`,
  );

  if (draft.countdown_target !== published.countdown_target) {
    items.push({
      id: "setting:countdown_target",
      category: "客户端设置",
      label: "倒计时目标",
      detail: `${published.countdown_target || "未设置"} → ${draft.countdown_target || "未设置"}`,
    });
  }
  if (draft.week_display !== published.week_display) {
    items.push({
      id: "setting:week_display",
      category: "客户端设置",
      label: "星期显示",
      detail: `${published.week_display ? "显示" : "隐藏"} → ${draft.week_display ? "显示" : "隐藏"}`,
    });
  }
  addRecordChanges(
    items,
    "客户端设置",
    "style",
    draft.css_style,
    published.css_style,
    (key) => `样式 ${key}`,
  );

  return items;
}
