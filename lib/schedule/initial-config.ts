import {
  PLACEHOLDER_SUBJECT_CODE,
  PLACEHOLDER_SUBJECT_NAME,
  WEEKDAYS,
  type ScheduleConfig,
} from "./types";

export function createBlankConfig(): ScheduleConfig {
  const workday = {
    "08:00-08:39": 0,
    "08:40-08:49": "课间",
    "08:50-09:29": 1,
    "09:30-09:59": "课间",
    "10:00-10:39": 2,
  } as Record<string, number | string>;

  const weekend = {
    "09:00-09:59": 0,
    "10:00-10:09": "课间",
    "10:10-11:09": 1,
  } as Record<string, number | string>;

  return {
    countdown_target: "hidden",
    week_display: true,
    subject_name: {
      [PLACEHOLDER_SUBJECT_CODE]: PLACEHOLDER_SUBJECT_NAME,
      CH: "语文",
      MA: "数学",
      EN: "英语",
    },
    timetable: { workday, weekend },
    divider: { workday: [1], weekend: [] },
    daily_class: WEEKDAYS.map((day, index) => ({
      ...day,
      timetable: index === 0 || index === 6 ? "weekend" : "workday",
      classList: [PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE, PLACEHOLDER_SUBJECT_CODE],
    })),
    css_style: {},
  };
}
