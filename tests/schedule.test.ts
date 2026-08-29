import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyAutoArrange,
  generateAutoArrangeRows,
  previewAutoArrange,
} from "@/lib/schedule/auto-arrange";
import {
  getAdjustmentChangedCells,
  getEffectiveScheduleConfig,
  getScheduleWeekWindow,
  isAdjustmentActive,
  setAdjustmentCourse,
  swapAdjustmentCourses,
  validateAdjustmentConfig,
} from "@/lib/schedule/adjustment";
import { diffScheduleConfigs } from "@/lib/schedule/diff";
import {
  addTemplateRow,
  assignDayTemplate,
  setDayCourse,
  swapDayCourses,
  updateSubject,
} from "@/lib/schedule/editor-operations";
import { createBlankConfig } from "@/lib/schedule/initial-config";
import { normalizeScheduleConfig } from "@/lib/schedule/normalize";
import {
  composeSubjectCode,
  parseSubjectCode,
  validateSubjectCodeFields,
} from "@/lib/schedule/subject-code";
import { PLACEHOLDER_SUBJECT_CODE } from "@/lib/schedule/types";
import { validateScheduleConfig } from "@/lib/schedule/validation";

function loadLegacyConfig() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "prisma/seed-config.json"), "utf8")) as unknown;
}

describe("subject code helpers", () => {
  it("keeps simple codes simple and composes composite codes", () => {
    expect(composeSubjectCode("simple", " 物 ")).toBe("物");
    expect(composeSubjectCode("composite", " 自 ", " 语 ")).toBe("自@语");
    expect(parseSubjectCode("自@语")).toEqual({ mode: "composite", primary: "自", secondary: "语" });
  });

  it("preserves the remainder of legacy composite codes when parsing", () => {
    expect(parseSubjectCode("自@语@测")).toEqual({ mode: "composite", primary: "自", secondary: "语@测" });
  });

  it("reports missing fields and reserved separators", () => {
    expect(validateSubjectCodeFields("simple", "", "")).toEqual({ primary: "请输入课程简称" });
    expect(validateSubjectCodeFields("composite", "自", "")).toEqual({ secondary: "请输入 @ 右侧代码" });
    expect(validateSubjectCodeFields("composite", "自@", "语")).toEqual({ primary: "这里不要输入 @" });
    expect(validateSubjectCodeFields("composite", "自", "语@测")).toEqual({ secondary: "这里不要输入 @" });
  });
});

describe("schedule config contract", () => {
  it("accepts the blank template and keeps the public root shape", () => {
    const config = createBlankConfig();
    const result = validateScheduleConfig(config);

    expect(result.success).toBe(true);
    expect(config).toHaveProperty("daily_class");
    expect(config).not.toHaveProperty("data");
    expect(config.daily_class).toHaveLength(7);
  });

  it("normalizes the existing Electron config into a publishable four-week config", () => {
    const result = normalizeScheduleConfig(loadLegacyConfig());

    expect(result.config.countdown_target).toBe("2024-06-07");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.config.daily_class.some((day) => day.classList.some((value) => Array.isArray(value) && value.length === 4))).toBe(true);
    expect(validateScheduleConfig(result.config).success).toBe(true);
  });

  it("renames the legacy placeholder code without leaving invalid references", () => {
    const config = createBlankConfig() as unknown as Record<string, any>;
    delete config.subject_name.TBD;
    config.subject_name.__UNASSIGNED__ = "待安排";
    config.daily_class[0].classList[0] = "__UNASSIGNED__";

    const result = normalizeScheduleConfig(config);

    expect(result.config.subject_name.TBD).toBe("待安排");
    expect(result.config.subject_name.__UNASSIGNED__).toBeUndefined();
    expect(result.config.daily_class[0].classList[0]).toBe("TBD");
    expect(validateScheduleConfig(result.config).success).toBe(true);
  });

  it("reports overlapping time ranges and unknown subject codes", () => {
    const config = createBlankConfig();
    config.timetable.workday = {
      "08:00-08:39": 0,
      "08:30-09:00": 1,
    };
    config.daily_class[1].classList[0] = "MISSING";

    const result = validateScheduleConfig(config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.message.includes("不能重叠"))).toBe(true);
      expect(result.issues.some((issue) => issue.message.includes("不存在于 subject_name"))).toBe(true);
    }
  });

  it("requires four values for rotating courses", () => {
    const config = createBlankConfig();
    config.daily_class[1].classList[0] = ["CH", "MA", "EN"];
    const result = validateScheduleConfig(config);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.message.includes("至少提供 4 项"))).toBe(true);
  });
});

describe("schedule differences", () => {
  it("summarizes course, template, and client setting changes", () => {
    const published = createBlankConfig();
    const draft = createBlankConfig();
    draft.subject_name.MATH = "数学";
    draft.daily_class[1].classList[0] = "MATH";
    draft.daily_class[1].timetable = "weekend";
    draft.timetable.weekend["09:00-09:39"] = 0;
    draft.week_display = false;
    draft.css_style["--center-font-size"] = "42px";

    const changes = diffScheduleConfigs(draft, published);

    expect(changes.some((item) => item.id === "course:1:0" && item.category === "课程安排")).toBe(true);
    expect(changes.some((item) => item.id === "day-template:1" && item.category === "时间模板")).toBe(true);
    expect(changes.some((item) => item.id === "template:weekend" && item.category === "时间模板")).toBe(true);
    expect(changes.some((item) => item.id === "setting:week_display" && item.category === "客户端设置")).toBe(true);
    expect(changes.some((item) => item.id === "style:--center-font-size" && item.category === "客户端设置")).toBe(true);
  });

  it("shows which weeks changed for a rotating course", () => {
    const published = createBlankConfig();
    const draft = createBlankConfig();
    published.daily_class[1].classList[0] = ["CH", "MA", "EN", "CH"];
    draft.daily_class[1].classList[0] = ["CH", "MA", "MA", "CH"];

    const courseChange = diffScheduleConfigs(draft, published).find((item) => item.id === "course:1:0");

    expect(courseChange?.detail).toContain("第 3 周");
    expect(courseChange?.detail).not.toContain("第 1 周");
  });
});

describe("editor operations", () => {
  it("renames composite subjects and updates their schedule references", () => {
    const config = createBlankConfig();
    config.subject_name["自@语"] = "语文周测";
    config.daily_class[0].classList[0] = "自@语";

    const next = updateSubject(config, "自@语", "自@测", "语文测验");

    expect(next.subject_name["自@语"]).toBeUndefined();
    expect(next.subject_name["自@测"]).toBe("语文测验");
    expect(next.daily_class[0].classList[0]).toBe("自@测");
  });

  it("changes only the selected week for a rotating course", () => {
    const config = createBlankConfig();
    config.daily_class[1].classList[0] = ["CH", "MA", "EN", "CH"];

    const next = setDayCourse(config, 1, 0, 2, "MA");

    expect(next.daily_class[1].classList[0]).toEqual(["CH", "MA", "MA", "CH"]);
    expect(next).not.toBe(config);
  });

  it("swaps the selected week between two cells", () => {
    const config = createBlankConfig();
    config.daily_class[1].classList[0] = ["CH", "MA", "EN", "CH"];
    config.daily_class[1].classList[1] = ["MA", "EN", "CH", "MA"];

    const next = swapDayCourses(config, 1, 0, 1, 1, 2);

    expect(next.daily_class[1].classList[0]).toEqual(["CH", "MA", "CH", "CH"]);
    expect(next.daily_class[1].classList[1]).toEqual(["MA", "EN", "EN", "MA"]);
  });

  it("adds a class row and propagates a placeholder to days using the template", () => {
    const config = createBlankConfig();
    const next = addTemplateRow(config, "workday", { timeRange: "11:00-11:39", kind: "class" }, "__UNASSIGNED__");

    expect(next.timetable.workday["11:00-11:39"]).toBe(3);
    expect(next.daily_class[1].classList).toHaveLength(4);
    expect(next.daily_class[1].classList[3]).toBe("__UNASSIGNED__");
    expect(next.daily_class[0].classList).toHaveLength(3);
  });

  it("keeps a day valid when switching templates and switching back", () => {
    const config = createBlankConfig();
    delete config.subject_name[PLACEHOLDER_SUBJECT_CODE];

    const workday = assignDayTemplate(config, 0, "workday", PLACEHOLDER_SUBJECT_CODE);
    expect(workday.subject_name[PLACEHOLDER_SUBJECT_CODE]).toBe("待安排");
    expect(workday.daily_class[0].classList).toHaveLength(3);
    expect(validateScheduleConfig(workday).success).toBe(true);

    const weekend = assignDayTemplate(workday, 0, "weekend", PLACEHOLDER_SUBJECT_CODE);
    expect(weekend.daily_class[0].timetable).toBe("weekend");
    expect(weekend.daily_class[0].classList).toHaveLength(2);
    expect(validateScheduleConfig(weekend).success).toBe(true);
  });
});

describe("temporary schedule adjustments", () => {
  it("calculates the current calendar week in Shanghai time", () => {
    expect(getScheduleWeekWindow(new Date("2026-08-30T15:59:59.000Z"))).toEqual({ start: "2026-08-24", end: "2026-08-30" });
    expect(getScheduleWeekWindow(new Date("2026-08-30T16:00:00.000Z"))).toEqual({ start: "2026-08-31", end: "2026-09-06" });
  });

  it("only keeps an adjustment active during its saved calendar week", () => {
    const adjustment = { weekStart: "2026-08-24" };
    expect(isAdjustmentActive(adjustment, new Date("2026-08-28T04:00:00.000Z"))).toBe(true);
    expect(isAdjustmentActive(adjustment, new Date("2026-08-30T16:00:00.000Z"))).toBe(false);
  });

  it("changes one rotation week and turns a fixed course into a four-week value", () => {
    const config = createBlankConfig();
    const next = setAdjustmentCourse(config, 1, 0, 2, "EN");

    expect(next.daily_class[1].classList[0]).toEqual(["TBD", "TBD", "EN", "TBD"]);
    expect(config.daily_class[1].classList[0]).toBe("TBD");
  });

  it("swaps only the locked rotation week", () => {
    const config = createBlankConfig();
    config.daily_class[1].classList[0] = ["CH", "MA", "EN", "CH"];
    config.daily_class[1].classList[1] = ["MA", "EN", "CH", "MA"];

    const next = swapAdjustmentCourses(config, 1, 0, 1, 1, 2);

    expect(next.daily_class[1].classList[0]).toEqual(["CH", "MA", "CH", "CH"]);
    expect(next.daily_class[1].classList[1]).toEqual(["MA", "EN", "EN", "MA"]);
  });

  it("rejects changes outside the locked rotation week", () => {
    const base = createBlankConfig();
    const changed = setAdjustmentCourse(base, 1, 0, 1, "EN");
    const result = validateAdjustmentConfig(base, changed, 2);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.message).toContain("只能修改第 3 周");
  });

  it("identifies the cells touched by a saved adjustment", () => {
    const base = createBlankConfig();
    const changed = setAdjustmentCourse(base, 1, 0, 0, "EN");

    expect(getAdjustmentChangedCells(base, changed, 0)).toEqual([{ dayIndex: 1, classIndex: 0 }]);
    expect(getAdjustmentChangedCells(base, changed, 1)).toEqual([]);
  });

  it("uses the published config after an adjustment expires", () => {
    const published = createBlankConfig();
    const temporary = setAdjustmentCourse(published, 1, 0, 0, "EN");
    const adjustment = {
      weekStart: "2026-08-24",
      weekIndex: 0,
      sourceDraftVersion: 1,
      config: temporary,
      changedCells: [{ dayIndex: 1, classIndex: 0 }],
    };

    expect(getEffectiveScheduleConfig(published, adjustment, new Date("2026-08-28T04:00:00.000Z")).daily_class[1].classList[0]).toBe("EN");
    expect(getEffectiveScheduleConfig(published, adjustment, new Date("2026-08-30T16:00:00.000Z")).daily_class[1].classList[0]).toBe("TBD");
  });
});

describe("automatic timetable arrangement", () => {
  it("generates four 40-minute classes with 10-minute breaks", () => {
    const result = generateAutoArrangeRows({
      startTime: "08:00",
      classCount: 4,
      classDurationMinutes: 40,
      breakDurationMinutes: 10,
      breakLabel: "课间",
      dividerAfterBlock: true,
    });

    expect(result.rows.map((row) => row.timeRange)).toEqual([
      "08:00-08:39",
      "08:40-08:49",
      "08:50-09:29",
      "09:30-09:39",
      "09:40-10:19",
      "10:20-10:29",
      "10:30-11:09",
    ]);
    expect(result.rows.filter((row) => row.kind === "class")).toHaveLength(4);
    expect(result.rows.at(-1)?.divider).toBe(true);
    expect(result.endMinutes).toBe(11 * 60 + 10);
  });

  it("supports custom durations and does not add a break after the final class", () => {
    const result = generateAutoArrangeRows({
      startTime: "13:00",
      classCount: 3,
      classDurationMinutes: 45,
      breakDurationMinutes: 5,
      breakLabel: "课间休息",
      dividerAfterBlock: false,
    });

    expect(result.rows.map((row) => row.timeRange)).toEqual([
      "13:00-13:44",
      "13:45-13:49",
      "13:50-14:34",
      "14:35-14:39",
      "14:40-15:24",
    ]);
    expect(result.rows.at(-1)?.kind).toBe("class");
    expect(result.rows.at(-1)?.divider).toBe(false);
    expect(result.endMinutes).toBe(15 * 60 + 25);
  });

  it("allows adjacent classes when the break duration is zero", () => {
    const result = generateAutoArrangeRows({
      startTime: "09:00",
      classCount: 2,
      classDurationMinutes: 30,
      breakDurationMinutes: 0,
      breakLabel: "不会显示",
      dividerAfterBlock: true,
    });

    expect(result.rows.map((row) => row.timeRange)).toEqual(["09:00-09:29", "09:30-09:59"]);
    expect(result.rows.every((row) => row.kind === "class")).toBe(true);
  });

  it("rejects invalid values and blocks a block that crosses midnight", () => {
    expect(() => generateAutoArrangeRows({
      startTime: "08:00",
      classCount: 0,
      classDurationMinutes: 40,
      breakDurationMinutes: 10,
      breakLabel: "课间",
      dividerAfterBlock: true,
    })).toThrow("连续课程节数必须是大于 0 的整数");

    expect(() => generateAutoArrangeRows({
      startTime: "23:30",
      classCount: 2,
      classDurationMinutes: 40,
      breakDurationMinutes: 10,
      breakLabel: "课间",
      dividerAfterBlock: true,
    })).toThrow("不能超过当天 23:59");

    expect(() => generateAutoArrangeRows({
      startTime: "24:00",
      classCount: 1,
      classDurationMinutes: 40,
      breakDurationMinutes: 0,
      breakLabel: "课间",
      dividerAfterBlock: true,
    })).toThrow("开始时间必须使用 HH:MM 格式");
  });

  it("replaces only the selected block and keeps courses outside it", () => {
    const config = createBlankConfig();
    config.timetable.workday = {
      "08:00-08:39": 0,
      "08:40-08:49": "课间",
      "08:50-09:29": 1,
      "09:30-09:39": "课间",
      "09:40-10:19": 2,
      "10:20-10:29": "课间",
      "10:30-11:09": 3,
      "11:10-11:19": "课间",
      "11:20-11:59": 4,
      "12:00-12:59": "午休",
      "13:00-13:39": 5,
    };
    config.divider.workday = [4];
    config.daily_class[1].classList = [
      ["CH", "MA", "EN", "CH"],
      "MA",
      "EN",
      "CH",
      "MA",
      "EN",
    ];

    const options = {
      startTime: "08:00",
      classCount: 3,
      classDurationMinutes: 40,
      breakDurationMinutes: 10,
      breakLabel: "课间",
      dividerAfterBlock: true,
    };
    const preview = previewAutoArrange(config, "workday", options);

    expect(preview.replacedRows.map((row) => row.timeRange)).toEqual([
      "08:00-08:39",
      "08:40-08:49",
      "08:50-09:29",
      "09:30-09:39",
      "09:40-10:19",
    ]);
    expect(preview.preservedCourseCount).toBe(3);
    expect(preview.addedPlaceholderCount).toBe(0);

    const next = applyAutoArrange(config, "workday", options, PLACEHOLDER_SUBJECT_CODE);

    expect(Object.keys(next.timetable.workday)).toEqual([
      "08:00-08:39",
      "08:40-08:49",
      "08:50-09:29",
      "09:30-09:39",
      "09:40-10:19",
      "10:20-10:29",
      "10:30-11:09",
      "11:10-11:19",
      "11:20-11:59",
      "12:00-12:59",
      "13:00-13:39",
    ]);
    expect(next.daily_class[1].classList).toEqual([["CH", "MA", "EN", "CH"], "MA", "EN", "CH", "MA", "EN"]);
    expect(next.divider.workday).toEqual([2, 4]);
    expect(validateScheduleConfig(next).success).toBe(true);
  });

  it("adds placeholder slots when the block grows", () => {
    const config = createBlankConfig();
    const options = {
      startTime: "08:00",
      classCount: 4,
      classDurationMinutes: 40,
      breakDurationMinutes: 10,
      breakLabel: "课间",
      dividerAfterBlock: true,
    };

    const preview = previewAutoArrange(config, "workday", options);
    expect(preview.replacedRows).toHaveLength(5);
    expect(preview.addedPlaceholderCount).toBe(1);
    expect(preview.discardedCourseCount).toBe(0);

    const next = applyAutoArrange(config, "workday", options, PLACEHOLDER_SUBJECT_CODE);

    expect(next.daily_class[1].classList).toEqual([PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE]);
    expect(next.divider.workday).toEqual([3]);
    expect(validateScheduleConfig(next).success).toBe(true);
  });

  it("reports dropped courses when the generated block becomes shorter", () => {
    const config = createBlankConfig();
    const options = {
      startTime: "08:00",
      classCount: 1,
      classDurationMinutes: 90,
      breakDurationMinutes: 0,
      breakLabel: "课间",
      dividerAfterBlock: true,
    };

    const preview = previewAutoArrange(config, "workday", options);

    expect(preview.replacedRows.filter((row) => row.kind === "class")).toHaveLength(2);
    expect(preview.preservedCourseCount).toBe(1);
    expect(preview.discardedCourseCount).toBe(1);
    expect(preview.addedPlaceholderCount).toBe(0);
  });
});
