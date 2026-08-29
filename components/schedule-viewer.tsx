"use client";

import Link from "next/link";
import { CalendarClock, ChevronDown, Eye, Send } from "lucide-react";
import { useMemo, useState } from "react";

import type { PublicUser } from "@/lib/auth";
import { getTemplateRows } from "@/lib/schedule/editor-operations";
import {
  getCourseForWeek,
  isRotatingCourse,
  PLACEHOLDER_SUBJECT_NAME,
  WEEKDAYS,
  type ScheduleConfig,
  type TemplateRow,
} from "@/lib/schedule/types";
import { UserMenu } from "@/components/user-menu";

interface ScheduleViewerProps {
  config: ScheduleConfig;
  user: PublicUser;
  publishedAt?: string | null;
}

function formatTimeRange(timeRange: string) {
  return timeRange.replace("-", " - ");
}

function SubjectView({ config, code, rotating }: { config: ScheduleConfig; code: string; rotating: boolean }) {
  return (
    <div className="viewer-subject">
      <span className="viewer-subject-code">{code}</span>
      <strong>{config.subject_name[code] ?? PLACEHOLDER_SUBJECT_NAME}</strong>
      {rotating ? <span className="viewer-rotation-mark">4W</span> : null}
    </div>
  );
}

function ViewerRow({ config, row, activeTemplate, weekIndex }: {
  config: ScheduleConfig;
  row: TemplateRow;
  activeTemplate: string;
  weekIndex: number;
}) {
  return (
    <div className={`viewer-matrix-row${row.kind === "event" ? " viewer-matrix-row-event" : ""}`}>
      <div className="matrix-label-cell">
        <strong>{row.kind === "class" ? `第 ${(row.classIndex ?? 0) + 1} 节` : "事件"}</strong>
        <span>{formatTimeRange(row.timeRange)}</span>
      </div>
      {config.daily_class.map((day, dayIndex) => {
        if (day.timetable !== activeTemplate) {
          return <div className="disabled-cell" key={dayIndex}><span>{day.timetable}</span></div>;
        }
        if (row.kind === "event") return <div className="event-cell" key={dayIndex}><span>{row.eventLabel}</span></div>;
        const value = day.classList[row.classIndex ?? 0];
        const code = getCourseForWeek(value, weekIndex);
        return (
          <div className="viewer-course-cell" key={dayIndex}>
            <SubjectView config={config} code={code} rotating={isRotatingCourse(value ?? "")} />
          </div>
        );
      })}
    </div>
  );
}

function MobileViewerRow({ config, row, dayIndex, weekIndex }: {
  config: ScheduleConfig;
  row: TemplateRow;
  dayIndex: number;
  weekIndex: number;
}) {
  if (row.kind === "event") {
    return <div className="viewer-mobile-row viewer-mobile-row-event" key={row.timeRange}><span>{formatTimeRange(row.timeRange)}</span><strong>{row.eventLabel}</strong></div>;
  }

  const value = config.daily_class[dayIndex]?.classList[row.classIndex ?? 0];
  const code = getCourseForWeek(value, weekIndex);
  return (
    <div className="viewer-mobile-row" key={row.timeRange}>
      <span>{formatTimeRange(row.timeRange)}</span>
      <div className="viewer-course-cell">
        <SubjectView config={config} code={code} rotating={isRotatingCourse(value ?? "")} />
      </div>
    </div>
  );
}

export function ScheduleViewer({ config, user, publishedAt }: ScheduleViewerProps) {
  const [selectedDay, setSelectedDay] = useState(1);
  const [weekIndex, setWeekIndex] = useState(0);
  const [weekMenuOpen, setWeekMenuOpen] = useState(false);
  const activeTemplate = config.daily_class[selectedDay]?.timetable ?? Object.keys(config.timetable)[0] ?? "workday";
  const rows = useMemo(() => getTemplateRows(config, activeTemplate), [activeTemplate, config]);
  const mobileRows = useMemo(() => getTemplateRows(config, config.daily_class[selectedDay]?.timetable ?? activeTemplate), [activeTemplate, config, selectedDay]);

  return (
    <main className="viewer-shell">
      <header className="viewer-topbar">
        <Link className="viewer-brand" href="/" aria-label="课程表首页">
          <span className="viewer-brand-mark"><CalendarClock size={18} /></span>
          <span><strong>课程表</strong><small>已发布课表</small></span>
        </Link>
        <div className="viewer-topbar-right">
          <span className="viewer-published-status"><Send size={14} />{publishedAt ? `更新于 ${new Date(publishedAt).toLocaleString("zh-CN", { hour12: false })}` : "当前版本"}</span>
          <UserMenu user={user} showEditorLink showAdminLink />
        </div>
      </header>

      <div className="viewer-content">
        <section className="viewer-intro">
          <div>
            <p className="section-kicker">PUBLISHED SCHEDULE</p>
            <h1>课程表</h1>
            <p>当前显示已发布版本，临时调课会按本周规则生效。</p>
          </div>
        </section>

        <section className="viewer-controls" aria-label="课表查看选项">
          <div
            className={`viewer-week-picker${weekMenuOpen ? " is-open" : ""}`}
            onMouseEnter={() => setWeekMenuOpen(true)}
            onMouseLeave={() => setWeekMenuOpen(false)}
            onFocus={() => setWeekMenuOpen(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setWeekMenuOpen(false);
            }}
          >
            <button
              className="viewer-current-week"
              type="button"
              aria-expanded={weekMenuOpen}
              aria-haspopup="listbox"
              aria-controls="viewer-week-options"
              onClick={() => setWeekMenuOpen(true)}
            >
              <span>查看第 {weekIndex + 1} 周安排</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className="viewer-week-options" id="viewer-week-options" role="listbox" aria-label="选择轮换周次">
              {[0, 1, 2, 3].map((index) => (
                <button
                  key={index}
                  type="button"
                  role="option"
                  aria-selected={weekIndex === index}
                  className={weekIndex === index ? "is-active" : ""}
                  onClick={(event) => {
                    setWeekIndex(index);
                    setWeekMenuOpen(false);
                    event.currentTarget.blur();
                  }}
                >
                  第 {index + 1} 周
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="viewer-board-section">
          <div className="viewer-board-heading">
            <div>
              <p className="section-kicker">WEEKLY BOARD</p>
              <h2>星期矩阵</h2>
            </div>
            <span>{activeTemplate} · {rows.filter((row) => row.kind === "class").length} 个课程槽</span>
          </div>

          <div className="viewer-matrix" aria-label="已发布星期课程矩阵">
            <div className="viewer-matrix-header">
              <div className="matrix-label-cell"><span>节次</span><small>{activeTemplate}</small></div>
              {config.daily_class.map((day, dayIndex) => (
                <div className={`day-header${selectedDay === dayIndex ? " is-selected" : ""}`} key={dayIndex}>
                  <button type="button" aria-pressed={selectedDay === dayIndex} onClick={() => setSelectedDay(dayIndex)}>
                    <strong>{day.Chinese}</strong><span>{day.English}</span>
                  </button>
                </div>
              ))}
            </div>
            {rows.map((row) => <ViewerRow key={row.timeRange} config={config} row={row} activeTemplate={activeTemplate} weekIndex={weekIndex} />)}
          </div>

          <div className="viewer-mobile-day-tabs" role="tablist" aria-label="选择星期">
            {WEEKDAYS.map((day, index) => <button key={day.English} type="button" role="tab" aria-selected={selectedDay === index} className={selectedDay === index ? "is-active" : ""} onClick={() => setSelectedDay(index)}>{day.Chinese}</button>)}
          </div>
          <div className="viewer-mobile-list" aria-label="移动端课程列表">
            {mobileRows.map((row) => <MobileViewerRow key={row.timeRange} config={config} row={row} dayIndex={selectedDay} weekIndex={weekIndex} />)}
          </div>
          <p className="viewer-readonly-note"><Eye size={14} />当前为只读课表</p>
        </section>
      </div>
    </main>
  );
}
