import {
  cloneConfig,
  getCourseForWeek,
  setCourseForWeek,
  type CourseValue,
  PLACEHOLDER_SUBJECT_NAME,
  type ScheduleConfig,
  type TemplateRow,
  type TemplateRowDraft,
} from "./types";
import { parseTimeRange } from "./validation";

function sortRows(rows: TemplateRowDraft[]): TemplateRowDraft[] {
  return [...rows].sort((a, b) => {
    const aTime = parseTimeRange(a.timeRange)?.start ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseTimeRange(b.timeRange)?.start ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

export function getTemplateRows(config: ScheduleConfig, templateName: string): TemplateRow[] {
  const timetable = config.timetable[templateName] ?? {};
  const divider = config.divider[templateName] ?? [];
  let classIndex = 0;

  return Object.entries(timetable).map(([timeRange, value]) => {
    if (typeof value === "number") {
      const row = {
        timeRange,
        kind: "class" as const,
        sourceClassIndex: value,
        classIndex,
        divider: divider.includes(value),
      };
      classIndex += 1;
      return row;
    }
    return { timeRange, kind: "event" as const, eventLabel: value, divider: false };
  });
}

export function getClassRows(config: ScheduleConfig, templateName: string): TemplateRow[] {
  return getTemplateRows(config, templateName).filter((row) => row.kind === "class");
}

export function rebuildTemplate(
  config: ScheduleConfig,
  templateName: string,
  rows: TemplateRowDraft[],
  placeholderCode: string,
): ScheduleConfig {
  const next = cloneConfig(config);
  const orderedRows = sortRows(rows);
  const timetable: Record<string, number | string> = {};
  let newClassIndex = 0;

  for (const row of orderedRows) {
    if (row.kind === "class") {
      timetable[row.timeRange] = newClassIndex;
      newClassIndex += 1;
    } else {
      timetable[row.timeRange] = row.eventLabel?.trim() || "事件";
    }
  }

  if (!next.subject_name[placeholderCode]) next.subject_name[placeholderCode] = PLACEHOLDER_SUBJECT_NAME;
  next.timetable[templateName] = timetable;
  let dividerClassIndex = 0;
  next.divider[templateName] = orderedRows.reduce<number[]>((divider, row) => {
    if (row.kind === "class") {
      if (row.divider) divider.push(dividerClassIndex);
      dividerClassIndex += 1;
    }
    return divider;
  }, []);

  for (const [dayIndex, day] of next.daily_class.entries()) {
    if (day.timetable !== templateName) continue;
    const oldList = config.daily_class[dayIndex]?.classList ?? [];
    const newList: CourseValue[] = [];
    for (const row of orderedRows) {
      if (row.kind !== "class") continue;
      if (row.sourceClassIndex === undefined) {
        newList.push(placeholderCode);
      } else {
        newList.push(oldList[row.sourceClassIndex] ?? placeholderCode);
      }
    }
    day.classList = newList;
  }

  return next;
}

export function addTemplateRow(
  config: ScheduleConfig,
  templateName: string,
  row: Omit<TemplateRowDraft, "sourceClassIndex" | "classIndex">,
  placeholderCode: string,
): ScheduleConfig {
  const rows = getTemplateRows(config, templateName);
  return rebuildTemplate(config, templateName, [...rows, row], placeholderCode);
}

export function updateTemplateRow(
  config: ScheduleConfig,
  templateName: string,
  currentTimeRange: string,
  update: Partial<Pick<TemplateRowDraft, "timeRange" | "eventLabel" | "kind" | "divider">>,
  placeholderCode: string,
): ScheduleConfig {
  const rows = getTemplateRows(config, templateName).map((row) => {
    if (row.timeRange !== currentTimeRange) return row;
    return { ...row, ...update };
  });
  return rebuildTemplate(config, templateName, rows, placeholderCode);
}

export function removeTemplateRow(config: ScheduleConfig, templateName: string, timeRange: string, placeholderCode: string): ScheduleConfig {
  const rows = getTemplateRows(config, templateName).filter((row) => row.timeRange !== timeRange);
  return rebuildTemplate(config, templateName, rows, placeholderCode);
}

export function setTemplateDivider(config: ScheduleConfig, templateName: string, classIndex: number, enabled: boolean): ScheduleConfig {
  const next = cloneConfig(config);
  const divider = new Set(next.divider[templateName] ?? []);
  if (enabled) divider.add(classIndex);
  else divider.delete(classIndex);
  next.divider[templateName] = [...divider].sort((a, b) => a - b);
  return next;
}

export function addTemplate(config: ScheduleConfig, templateName: string, placeholderCode: string): ScheduleConfig {
  const next = cloneConfig(config);
  const normalizedName = templateName.trim();
  if (!normalizedName || next.timetable[normalizedName]) return next;
  if (!next.subject_name[placeholderCode]) next.subject_name[placeholderCode] = PLACEHOLDER_SUBJECT_NAME;
  next.timetable[normalizedName] = { "08:00-08:39": 0 };
  next.divider[normalizedName] = [];
  next.daily_class = next.daily_class.map((day) => ({ ...day, classList: [...day.classList] }));
  return next;
}

export function renameTemplate(config: ScheduleConfig, oldName: string, newName: string): ScheduleConfig {
  const next = cloneConfig(config);
  const normalizedName = newName.trim();
  if (!normalizedName || oldName === normalizedName || next.timetable[normalizedName]) return next;
  const entries = Object.entries(next.timetable).map(([name, value]) => [name === oldName ? normalizedName : name, value] as const);
  next.timetable = Object.fromEntries(entries);
  const dividerEntries = Object.entries(next.divider).map(([name, value]) => [name === oldName ? normalizedName : name, value] as const);
  next.divider = Object.fromEntries(dividerEntries);
  next.daily_class = next.daily_class.map((day) => ({
    ...day,
    timetable: day.timetable === oldName ? normalizedName : day.timetable,
    classList: [...day.classList],
  }));
  return next;
}

export function removeTemplate(config: ScheduleConfig, templateName: string): ScheduleConfig {
  if (config.daily_class.some((day) => day.timetable === templateName)) return config;
  const next = cloneConfig(config);
  delete next.timetable[templateName];
  delete next.divider[templateName];
  return next;
}

export function assignDayTemplate(config: ScheduleConfig, dayIndex: number, templateName: string, placeholderCode: string): ScheduleConfig {
  const next = cloneConfig(config);
  const day = next.daily_class[dayIndex];
  const template = next.timetable[templateName];
  if (!day || !template) return next;
  if (!next.subject_name[placeholderCode]) next.subject_name[placeholderCode] = PLACEHOLDER_SUBJECT_NAME;
  const classCount = Object.values(template).filter((value) => typeof value === "number").length;
  day.timetable = templateName;
  day.classList = Array.from({ length: classCount }, (_, index) => day.classList[index] ?? placeholderCode);
  return next;
}

export function setDayCourse(config: ScheduleConfig, dayIndex: number, classIndex: number, weekIndex: number, code: string): ScheduleConfig {
  const next = cloneConfig(config);
  const day = next.daily_class[dayIndex];
  if (!day) return next;
  day.classList[classIndex] = setCourseForWeek(day.classList[classIndex], weekIndex, code);
  return next;
}

export function swapDayCourses(
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
  sourceDay.classList[sourceClassIndex] = setCourseForWeek(sourceDay.classList[sourceClassIndex], weekIndex, targetValue);
  targetDay.classList[targetClassIndex] = setCourseForWeek(targetDay.classList[targetClassIndex], weekIndex, sourceValue);
  return next;
}

export function addSubject(config: ScheduleConfig, code: string, name: string): ScheduleConfig {
  const normalizedCode = code.trim();
  const normalizedName = name.trim();
  if (!normalizedCode || !normalizedName) return config;
  const next = cloneConfig(config);
  next.subject_name[normalizedCode] = normalizedName;
  return next;
}

export function updateSubject(config: ScheduleConfig, oldCode: string, newCode: string, name: string): ScheduleConfig {
  const normalizedCode = newCode.trim();
  const normalizedName = name.trim();
  if (!normalizedCode || !normalizedName) return config;
  const next = cloneConfig(config);
  if (oldCode !== normalizedCode && next.subject_name[normalizedCode]) return config;
  delete next.subject_name[oldCode];
  next.subject_name[normalizedCode] = normalizedName;
  next.daily_class = next.daily_class.map((day) => ({
    ...day,
    classList: day.classList.map((value) => {
      if (Array.isArray(value)) return value.map((item) => (item === oldCode ? normalizedCode : item));
      return value === oldCode ? normalizedCode : value;
    }),
  }));
  return next;
}

export function subjectReferences(config: ScheduleConfig, code: string): string[] {
  const references: string[] = [];
  config.daily_class.forEach((day, dayIndex) => {
    day.classList.forEach((value, classIndex) => {
      const values = Array.isArray(value) ? value : [value];
      if (values.includes(code)) references.push(`星期 ${dayIndex} 第 ${classIndex + 1} 节`);
    });
  });
  return references;
}

export function copyWeek(config: ScheduleConfig, sourceWeek: number, targetWeek: number): ScheduleConfig {
  const next = cloneConfig(config);
  next.daily_class = next.daily_class.map((day) => ({
    ...day,
    classList: day.classList.map((value) => {
      if (!Array.isArray(value)) return value;
      const values = [...value];
      while (values.length < 4) values.push(values[values.length - 1] ?? "");
      values[targetWeek] = values[sourceWeek] ?? values[values.length - 1];
      return values.slice(0, 4);
    }),
  }));
  return next;
}

export function getTemplateCourseCount(config: ScheduleConfig, templateName: string): number {
  return getClassRows(config, templateName).length;
}
