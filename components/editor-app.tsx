"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  BookmarkPlus,
  BookOpen,
  CalendarClock,
  Check,
  Clock3,
  ChevronDown,
  ClipboardCopy,
  Download,
  Eye,
  GitCompareArrows,
  GripVertical,
  History,
  Import,
  LayoutGrid,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EditorPresence } from "@/components/editor-presence";
import type { PublicUser } from "@/lib/auth";
import {
  applyAutoArrange,
  previewAutoArrange,
  type AutoArrangeOptions,
} from "@/lib/schedule/auto-arrange";
import {
  addSubject,
  addTemplate,
  addTemplateRow,
  assignDayTemplate,
  copyWeek,
  getClassRows,
  getTemplateCourseCount,
  getTemplateRows,
  removeTemplate,
  removeTemplateRow,
  renameTemplate,
  setDayCourse,
  setTemplateDivider,
  subjectReferences,
  swapDayCourses,
  updateSubject,
  updateTemplateRow,
} from "@/lib/schedule/editor-operations";
import { createBlankConfig } from "@/lib/schedule/initial-config";
import { diffScheduleConfigs, type ScheduleDiffItem } from "@/lib/schedule/diff";
import { normalizeScheduleConfig } from "@/lib/schedule/normalize";
import {
  composeSubjectCode,
  parseSubjectCode,
  validateSubjectCodeFields,
  type SubjectCodeFieldErrors,
  type SubjectEntryMode,
} from "@/lib/schedule/subject-code";
import {
  getCourseForWeek,
  isRotatingCourse,
  cloneConfig,
  PLACEHOLDER_SUBJECT_CODE,
  PLACEHOLDER_SUBJECT_NAME,
  WEEKDAYS,
  type ScheduleAdjustmentView,
  type ScheduleDocumentView,
  type ScheduleRevisionView,
  type ScheduleConfig,
  type ScheduleWeekWindow,
  type TemplateRow,
} from "@/lib/schedule/types";
import {
  formatScheduleDate,
  getScheduleWeekWindow,
  setAdjustmentCourse,
  swapAdjustmentCourses,
} from "@/lib/schedule/adjustment";
import { parseTimeRange, ScheduleValidationError, validateScheduleConfig } from "@/lib/schedule/validation";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type RevisionLoadState = "idle" | "loading" | "ready" | "error";
type HistoryTab = "diff" | "history";
type WorkspacePanel = "schedule" | "templates" | "subjects" | "inspector" | "style" | "preview" | "validity";
type SelectedCell = { dayIndex: number; classIndex: number } | null;
type AdjustmentCellDisplay = { note: string; targetName: string };
type ConfigUpdater = (config: ScheduleConfig) => ScheduleConfig;
type ResizeSide = "left";

const pointerPreferredCollisionDetection = (args: Parameters<typeof closestCenter>[0]) => {
  const candidateArgs = {
    ...args,
    // The dragged course is also registered as a droppable. Its transformed
    // rectangle can overlap the real target and win pointerWithin's ordering.
    droppableContainers: args.droppableContainers.filter((container) => container.id !== args.active.id),
  };

  // Pointer drags should only target the course directly under the pointer.
  // Keyboard drags have no pointer coordinates, so they still use center-based navigation.
  return args.pointerCoordinates ? pointerWithin(candidateArgs) : closestCenter(candidateArgs);
};

const RAIL_LIMITS = {
  left: { min: 220, max: 420 },
} as const;

const STYLE_FIELDS = [
  { key: "--center-font-size", label: "主内容字号", placeholder: "50px" },
  { key: "--sub-font-size", label: "副标题字号", placeholder: "20px" },
  { key: "--corner-font-size", label: "角落字号", placeholder: "14px" },
  { key: "--countdown-font-size", label: "倒计时字号", placeholder: "28px" },
  { key: "--global-border-radius", label: "全局圆角", placeholder: "16px" },
  { key: "--global-bg-opacity", label: "背景透明度", placeholder: "0.5" },
  { key: "--container-bg-padding", label: "容器内边距", placeholder: "8px 14px" },
  { key: "--countdown-bg-padding", label: "倒计时内边距", placeholder: "5px 12px" },
  { key: "--container-space", label: "容器间距", placeholder: "16px" },
  { key: "--top-space", label: "顶部间距", placeholder: "16px" },
  { key: "--main-horizontal-space", label: "主体横向间距", placeholder: "8px" },
  { key: "--divider-width", label: "分隔线宽度", placeholder: "2px" },
  { key: "--divider-margin", label: "分隔线间距", placeholder: "6px" },
  { key: "--triangle-size", label: "提示三角尺寸", placeholder: "16px" },
];

function formatTimeRange(timeRange: string) {
  return timeRange.replace("-", " - ");
}

function splitTimeRange(timeRange: string) {
  const [start = "", end = ""] = timeRange.split("-");
  return { start, end };
}

type AutoArrangeFormState = {
  startTime: string;
  classCount: string;
  classDurationMinutes: string;
  breakDurationMinutes: string;
  breakLabel: string;
  dividerAfterBlock: boolean;
};

function minutesInTimeRange(timeRange: string): number | null {
  const parsed = parseTimeRange(timeRange);
  return parsed ? parsed.end - parsed.start + 1 : null;
}

function inferAutoArrangeOptions(config: ScheduleConfig, templateName: string): AutoArrangeOptions {
  const rows = getTemplateRows(config, templateName);
  const firstClass = rows.find((row) => row.kind === "class");
  const firstClassRange = firstClass ? splitTimeRange(firstClass.timeRange) : { start: "08:00", end: "08:39" };
  const breakRowIndex = rows.findIndex(
    (row, index) => row.kind === "event" && rows[index - 1]?.kind === "class" && rows[index + 1]?.kind === "class",
  );
  const breakRow = breakRowIndex >= 0 ? rows[breakRowIndex] : undefined;

  return {
    startTime: firstClassRange.start,
    classCount: 4,
    classDurationMinutes: minutesInTimeRange(firstClass?.timeRange ?? "08:00-08:39") ?? 40,
    breakDurationMinutes: minutesInTimeRange(breakRow?.timeRange ?? "08:40-08:49") ?? 10,
    breakLabel: breakRow?.eventLabel?.trim() || "课间",
    dividerAfterBlock: true,
  };
}

function autoArrangeFormState(options: AutoArrangeOptions): AutoArrangeFormState {
  return {
    startTime: options.startTime,
    classCount: String(options.classCount),
    classDurationMinutes: String(options.classDurationMinutes),
    breakDurationMinutes: String(options.breakDurationMinutes),
    breakLabel: options.breakLabel,
    dividerAfterBlock: options.dividerAfterBlock,
  };
}

function autoArrangeOptionsFromForm(state: AutoArrangeFormState): AutoArrangeOptions {
  return {
    startTime: state.startTime,
    classCount: Number(state.classCount),
    classDurationMinutes: Number(state.classDurationMinutes),
    breakDurationMinutes: Number(state.breakDurationMinutes),
    breakLabel: state.breakLabel,
    dividerAfterBlock: state.dividerAfterBlock,
  };
}

function formatMinutesOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function overlapsTimeRange(rows: TemplateRow[], candidate: string, except?: string) {
  const candidateRange = parseTimeRange(candidate);
  if (!candidateRange) return false;
  return rows.some((row) => {
    if (row.timeRange === except) return false;
    const range = parseTimeRange(row.timeRange);
    if (!range) return false;
    return candidateRange.start <= range.end && range.start <= candidateRange.end;
  });
}

function errorMessage(error: unknown) {
  if (error instanceof ScheduleValidationError) {
    return error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；");
  }
  if (error instanceof Error) return error.message;
  return "发生了未知错误";
}

function formatSavedTime(value: string | null) {
  if (!value) return "尚未保存";
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatRevisionTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function revisionSourceLabel(source: ScheduleRevisionView["source"]) {
  if (source === "publish") return "发布快照";
  if (source === "restore") return "恢复快照";
  return "手动快照";
}

function revisionVersionLabel(revision: ScheduleRevisionView) {
  return revision.source === "restore" ? `恢复后草稿 v${revision.draftVersion}` : `草稿 v${revision.draftVersion}`;
}

class DraftConflictError extends Error {
  current: ScheduleDocumentView;

  constructor(message: string, current: ScheduleDocumentView) {
    super(message);
    this.name = "DraftConflictError";
    this.current = current;
  }
}

function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(timeoutId);
  }, [message, onDismiss]);

  return (
    <div className="notice" role="status" aria-live="polite">
      <span>{message}</span>
      <button className="icon-button" type="button" aria-label="关闭提示" title="关闭提示" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}

function DraftStatusControl({
  saveState,
  dirty,
  draftVersion,
  draftUpdatedAt,
  unpublishedChanges,
}: {
  saveState: SaveState;
  dirty: boolean;
  draftVersion: number;
  draftUpdatedAt: string | null;
  unpublishedChanges: number;
}) {
  const saveLabel = saveState === "saving"
    ? "正在保存"
    : saveState === "error"
      ? "保存失败"
      : dirty
        ? "等待保存"
        : `已保存 ${formatSavedTime(draftUpdatedAt)}`;
  const changeLabel = unpublishedChanges ? `未发布 ${unpublishedChanges} 项` : "与已发布一致";
  const stateLabel = saveState === "saving"
    ? "正在保存"
    : saveState === "error"
      ? "保存失败"
      : dirty
        ? "有未保存改动"
        : "草稿已保存";
  const stateClass = saveState === "saving" ? "status-saving" : saveState === "error" ? "status-error" : dirty ? "status-dirty" : "status-saved";
  const icon = saveState === "saving" ? <RefreshCw size={14} /> : saveState === "error" ? <AlertTriangle size={14} /> : dirty ? <span className="status-dot" /> : <Check size={14} />;
  const accessibleLabel = `${saveLabel}，草稿 v${draftVersion}，${changeLabel}`;

  return (
    <div
      className={`draft-status-control${unpublishedChanges ? " has-changes" : ""}${dirty ? " is-dirty" : ""}`}
      role="status"
      aria-label={accessibleLabel}
      title={`${accessibleLabel}${draftUpdatedAt ? `，最后保存于 ${formatRevisionTime(draftUpdatedAt)}` : ""}`}
    >
      <span className="draft-status-surface" aria-hidden="true">
        <span className="draft-status-compact">
          <span className={`draft-status-mark ${stateClass}`} role="status" aria-label={stateLabel}>{icon}</span>
          <span className="draft-status-version">v{draftVersion}</span>
        </span>
        <span className="draft-status-expanded">
          <span className="draft-status-expanded-version">草稿 v{draftVersion}</span>
          <span className="draft-status-separator">·</span>
          <span>{changeLabel}</span>
        </span>
      </span>
    </div>
  );
}

function AdjustmentModeStatus({ dirty, weekIndex }: { dirty: boolean; weekIndex: number }) {
  return (
    <div className={`adjustment-mode-status${dirty ? " is-dirty" : ""}`} role="status" aria-live="polite">
      <span className="adjustment-mode-status-mark"><CalendarClock size={14} /></span>
      <span>
        <strong>调课模式</strong>
        <small>{dirty ? "等待保存" : `第 ${weekIndex + 1} 周 · 本周有效`}</small>
      </span>
    </div>
  );
}

function TemporaryAdjustmentStatus({ status }: { status: ScheduleAdjustmentView["status"] }) {
  const isActive = status === "active";
  return (
    <span className={`temporary-adjustment-status${isActive ? " is-active" : ""}`} role="status">
      <Clock3 size={13} aria-hidden="true" />
      {isActive ? "本周调课已生效" : "调课待发布"}
    </span>
  );
}

function VersionMarker({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value?: number;
  label: string;
}) {
  return (
    <span className="version-marker" role="img" data-tooltip={label} title={label} aria-label={label}>
      {icon}
      {value !== undefined ? <sup>{value}</sup> : null}
    </span>
  );
}

function useScrollbarActivity() {
  useEffect(() => {
    const activeElements = new Set<HTMLElement>();
    const timers = new Map<HTMLElement, number>();

    const markScrolling = (event: Event) => {
      const element = event.target instanceof HTMLElement ? event.target : document.documentElement;
      const previousTimer = timers.get(element);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);

      activeElements.add(element);
      element.classList.add("is-scrolling");
      timers.set(element, window.setTimeout(() => {
        element.classList.remove("is-scrolling");
        activeElements.delete(element);
        timers.delete(element);
      }, 700));
    };

    document.addEventListener("scroll", markScrolling, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", markScrolling, true);
      timers.forEach((timer) => window.clearTimeout(timer));
      activeElements.forEach((element) => element.classList.remove("is-scrolling"));
    };
  }, []);
}

function VersionHistoryModal({
  activeTab,
  draftVersion,
  publishedVersion,
  draftUpdatedAt,
  diffItems,
  revisions,
  revisionsState,
  revisionNote,
  creatingRevision,
  restoringRevisionId,
  onTabChange,
  onNoteChange,
  onCreateRevision,
  onRestoreRevision,
  onClose,
}: {
  activeTab: HistoryTab;
  draftVersion: number;
  publishedVersion: number;
  draftUpdatedAt: string | null;
  diffItems: ScheduleDiffItem[];
  revisions: ScheduleRevisionView[];
  revisionsState: RevisionLoadState;
  revisionNote: string;
  creatingRevision: boolean;
  restoringRevisionId: number | null;
  onTabChange: (tab: HistoryTab) => void;
  onNoteChange: (value: string) => void;
  onCreateRevision: () => void;
  onRestoreRevision: (id: number) => void;
  onClose: () => void;
}) {
  if (activeTab !== "diff" && activeTab !== "history") return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
        <header className="modal-heading">
          <div>
            <span className="section-kicker">DRAFT CONTROL</span>
            <h2 id="history-modal-title">草稿与版本</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭版本面板" title="关闭版本面板" onClick={onClose}><X size={17} /></button>
        </header>

        <div className="history-tabs" role="tablist" aria-label="版本视图">
          <button className={activeTab === "diff" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "diff"} onClick={() => onTabChange("diff")}><GitCompareArrows size={15} />待发布差异</button>
          <button className={activeTab === "history" ? "is-active" : ""} type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => onTabChange("history")}><History size={15} />版本历史</button>
        </div>

        {activeTab === "diff" ? (
          <div className="history-content" role="tabpanel">
            <div className="history-overview">
              <div>
                <strong>{diffItems.length ? `有 ${diffItems.length} 项修改等待发布` : "当前草稿与已发布版本一致"}</strong>
                <span>{diffItems.length ? "发布前请确认下面的变更" : "草稿内容已经和线上版本同步"}</span>
              </div>
              <div className="history-version-pair"><span>草稿 v{draftVersion}</span><span>已发布 v{publishedVersion}</span></div>
            </div>
            {diffItems.length ? (
              <ul className="diff-list">
                {diffItems.map((item) => (
                  <li key={item.id} className="diff-item">
                    <div className="diff-item-heading"><span className="diff-category">{item.category}</span><strong>{item.label}</strong></div>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="history-empty"><Check size={22} /><strong>没有待发布差异</strong><span>下一次编辑后的变化会显示在这里。</span></div>
            )}
          </div>
        ) : (
          <div className="history-content" role="tabpanel">
            <form className="revision-create-form" onSubmit={(event) => { event.preventDefault(); onCreateRevision(); }}>
              <label>
                <span>创建草稿快照</span>
                <input value={revisionNote} maxLength={191} placeholder="备注，例如：调整周三下午课程" onChange={(event) => onNoteChange(event.target.value)} />
              </label>
              <button className="secondary-button" type="submit" disabled={creatingRevision}><BookmarkPlus size={15} />{creatingRevision ? "创建中" : "创建快照"}</button>
            </form>
            {revisionsState === "loading" ? <div className="history-loading"><RefreshCw className="toolbar-spinner" size={17} />正在读取版本历史…</div> : null}
            {revisionsState === "error" ? <div className="history-empty"><AlertTriangle size={22} /><strong>版本历史暂时无法读取</strong><span>请稍后重试。</span></div> : null}
            {revisionsState === "ready" && revisions.length ? (
              <ul className="revision-list">
                {revisions.map((revision) => (
                  <li key={revision.id} className="revision-item">
                    <div className="revision-item-main">
                      <div className="revision-item-heading"><strong>快照 #{revision.id}</strong><span className={`revision-source revision-source-${revision.source}`}>{revisionSourceLabel(revision.source)}</span></div>
                      <span>{revision.note || "未添加备注"}</span>
                      <small>{formatRevisionTime(revision.createdAt)} · {revisionVersionLabel(revision)}{revision.publishedVersion ? ` · 发布 v${revision.publishedVersion}` : ""}</small>
                    </div>
                    <button className="mini-button" type="button" onClick={() => onRestoreRevision(revision.id)} disabled={restoringRevisionId !== null}><RotateCcw size={13} />{restoringRevisionId === revision.id ? "恢复中" : "恢复到草稿"}</button>
                  </li>
                ))}
              </ul>
            ) : null}
            {revisionsState === "ready" && revisions.length === 0 ? <div className="history-empty"><History size={22} /><strong>还没有历史快照</strong><span>发布或手动创建快照后，会在这里留下可恢复的记录。</span></div> : null}
          </div>
        )}

        <footer className="modal-footer"><span>最近保存：{draftUpdatedAt ? formatRevisionTime(draftUpdatedAt) : "尚未保存"}</span><button className="secondary-button" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}

function ConflictDialog({
  current,
  localConfig,
  resolving,
  onReload,
  onOverwrite,
  onClose,
}: {
  current: ScheduleDocumentView;
  localConfig: ScheduleConfig | null;
  resolving: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  const conflictItems = localConfig ? diffScheduleConfigs(localConfig, current.draftConfig) : [];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflict-modal-title">
        <header className="modal-heading">
          <div>
            <span className="section-kicker">SYNC CONFLICT</span>
            <h2 id="conflict-modal-title">草稿已在别处更新</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭冲突提示" title="关闭冲突提示" onClick={onClose} disabled={resolving}><X size={17} /></button>
        </header>
        <p className="modal-copy">服务器草稿当前是 v{current.draftVersion}。本页面的编辑尚未安全写入，请选择加载服务器版本或覆盖服务器草稿。</p>
        {conflictItems.length ? <p className="conflict-count">本地与服务器草稿之间有 {conflictItems.length} 项差异。</p> : null}
        <div className="conflict-actions">
          <button className="secondary-button" type="button" onClick={onReload} disabled={resolving}><RefreshCw size={15} />加载服务器版本</button>
          <button className="primary-button" type="button" onClick={onOverwrite} disabled={resolving || !localConfig}><BookmarkPlus size={15} />覆盖服务器草稿</button>
        </div>
        <button className="modal-dismiss-link" type="button" onClick={onClose} disabled={resolving}>暂不处理</button>
      </section>
    </div>
  );
}

function ActivityRail({
  activePanel,
  adjustmentMode,
  onSelect,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  activePanel: WorkspacePanel;
  adjustmentMode: boolean;
  onSelect: (panel: WorkspacePanel) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const items: Array<{ id: WorkspacePanel; label: string; icon: React.ReactNode }> = adjustmentMode
    ? [
        { id: "schedule", label: "课表", icon: <LayoutGrid size={19} /> },
        { id: "inspector", label: "课程检查", icon: <Settings2 size={19} /> },
        { id: "validity", label: "调课时效", icon: <Clock3 size={19} /> },
      ]
    : [
        { id: "schedule", label: "课表", icon: <LayoutGrid size={19} /> },
        { id: "templates", label: "日程模板", icon: <CalendarClock size={19} /> },
        { id: "subjects", label: "课程库", icon: <BookOpen size={19} /> },
        { id: "inspector", label: "课程检查", icon: <Settings2 size={19} /> },
        { id: "style", label: "客户端样式", icon: <Palette size={19} /> },
        { id: "preview", label: "客户端预览", icon: <Eye size={19} /> },
      ];

  return (
    <nav className="activity-rail" aria-label="编辑器工具">
      <div className="activity-items">
        {items.map((item) => (
          <button
            key={item.id}
            className={`activity-button${activePanel === item.id ? " is-active" : ""}`}
            type="button"
            aria-label={item.label}
            aria-current={activePanel === item.id ? "page" : undefined}
            data-tooltip={item.label}
            title={item.label}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <button
        className="activity-button activity-sidebar-toggle"
        type="button"
        aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        aria-pressed={sidebarCollapsed}
        data-tooltip={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        onClick={onToggleSidebar}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
    </nav>
  );
}

function AdjustmentValidityPanel({
  currentWeek,
  adjustment,
  weekIndex,
  onClear,
  clearing,
}: {
  currentWeek: ScheduleWeekWindow;
  adjustment: ScheduleAdjustmentView | null;
  weekIndex: number;
  onClear: () => void;
  clearing: boolean;
}) {
  return (
    <section className="panel-section panel-adjustment-validity">
      <div className="section-heading">
        <div>
          <p className="section-kicker">VALIDITY</p>
          <h2>调课时效</h2>
        </div>
        <Clock3 size={18} aria-hidden="true" />
      </div>
      <div className="adjustment-state-card">
        <span className={`adjustment-state-mark${adjustment?.status === "active" ? " is-active" : ""}`}><span /></span>
        <div>
          <strong>{adjustment?.status === "active" ? "本周调课已生效" : adjustment ? "调课草稿待发布" : "等待确认调课"}</strong>
          <span>{adjustment ? `调课版本 v${adjustment.version}` : "保存后等待发布"}</span>
        </div>
      </div>
      <div className="adjustment-validity-grid">
        <div>
          <span>有效期</span>
          <strong>{formatScheduleDate(currentWeek.start)} - {formatScheduleDate(currentWeek.end)}</strong>
        </div>
        <div>
          <span>时效</span>
          <strong>一周 / 一次</strong>
        </div>
        <div>
          <span>轮换基线</span>
          <strong>第 {weekIndex + 1} 周</strong>
        </div>
      </div>
      <p className="panel-help adjustment-validity-help">{adjustment?.status === "active" ? "本周结束后自动恢复原课表。" : "点击顶部“发布草稿”后，本周调课才会进入课表。"}</p>
      {adjustment ? (
        <button className="danger-link adjustment-clear-button" type="button" onClick={onClear} disabled={clearing}>
          <Trash2 size={14} />{clearing ? "清除中" : "清除本周调课"}
        </button>
      ) : null}
    </section>
  );
}

function SidebarHeader({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="sidebar-header">
      <div className="sidebar-heading">
        <span className="sidebar-kicker">WORKSPACE</span>
        <strong>编辑面板</strong>
      </div>
      <button className="icon-button icon-button-subtle" type="button" aria-label="收起侧栏" data-tooltip="收起侧栏" title="收起侧栏" onClick={onCollapse}>
        <PanelLeftClose size={17} />
      </button>
    </div>
  );
}

function TimeRangeFields({
  value,
  onChange,
  onCommit,
  onInvalid,
}: {
  value: string;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
  onInvalid?: () => void;
}) {
  const initial = splitTimeRange(value);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  function updateRange(nextStart: string, nextEnd: string) {
    setStart(nextStart);
    setEnd(nextEnd);
    onChange?.(`${nextStart}-${nextEnd}`);
  }

  function commitRange() {
    const next = `${start}-${end}`;
    if (next === value) return;
    const parsed = parseTimeRange(next);
    if (!parsed || parsed.start >= parsed.end) {
      const previous = splitTimeRange(value);
      setStart(previous.start);
      setEnd(previous.end);
      onInvalid?.();
      return;
    }
    onCommit?.(next);
  }

  return (
    <div
      className="time-range-fields"
      onBlur={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
        commitRange();
      }}
    >
      <label>
        <span>开始</span>
        <input
          type="time"
          value={start}
          min="00:00"
          max="23:59"
          step="60"
          aria-label="开始时间"
          onChange={(event) => updateRange(event.target.value, end)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitRange();
          }}
        />
      </label>
      <span className="time-range-separator" aria-hidden="true">—</span>
      <label>
        <span>结束</span>
        <input
          type="time"
          value={end}
          min="00:00"
          max="23:59"
          step="60"
          aria-label="结束时间"
          onChange={(event) => updateRange(start, event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitRange();
          }}
        />
      </label>
    </div>
  );
}

function SidebarOverview({
  config,
  activeTemplate,
  selectedDay,
  weekIndex,
  selectedCell,
  adjustmentMode,
  temporaryAdjustment,
  onClearAdjustment,
  clearingAdjustment,
  onSelect,
}: {
  config: ScheduleConfig;
  activeTemplate: string;
  selectedDay: number;
  weekIndex: number;
  selectedCell: SelectedCell;
  adjustmentMode: boolean;
  temporaryAdjustment: ScheduleAdjustmentView | null;
  onClearAdjustment: () => void;
  clearingAdjustment: boolean;
  onSelect: (panel: WorkspacePanel) => void;
}) {
  const courseSlots = getClassRows(config, activeTemplate).length;
  const assignedCourses = config.daily_class.reduce(
    (count, day) => count + day.classList.filter((value) => getCourseForWeek(value, weekIndex) !== PLACEHOLDER_SUBJECT_CODE).length,
    0,
  );

  return (
    <section className="sidebar-overview">
      <div className="overview-intro">
        <span className="overview-mark"><LayoutGrid size={17} /></span>
        <div>
          <p className="section-kicker">{adjustmentMode ? "ADJUSTMENT" : "SCHEDULE"}</p>
          <h2>{adjustmentMode ? "本周调课" : "本周课表"}</h2>
        </div>
      </div>
      <p className="panel-help">{adjustmentMode ? "当前只编辑课程单元，确认后保存为调课草稿，发布后本周生效。" : "从左侧工具切换工作面板，中央区域始终保留当前课表。"}</p>
      <div className="overview-grid">
        <div>
          <span>模板</span>
          <strong>{activeTemplate}</strong>
        </div>
        <div>
          <span>周次</span>
          <strong>第 {weekIndex + 1} 周</strong>
        </div>
        <div>
          <span>课程槽</span>
          <strong>{courseSlots}</strong>
        </div>
        <div>
          <span>已安排</span>
          <strong>{assignedCourses}</strong>
        </div>
      </div>
      <div className="overview-selection">
        <span>当前定位</span>
        <strong>
          {selectedCell ? `${WEEKDAYS[selectedCell.dayIndex].Chinese} · 第 ${selectedCell.classIndex + 1} 节` : `${WEEKDAYS[selectedDay].Chinese} · 点击课程单元格`}
        </strong>
      </div>
      <div className="overview-actions">
        {adjustmentMode ? (
          <>
            <button className="secondary-button" type="button" onClick={() => onSelect("inspector")}><Settings2 size={15} />检查</button>
            <button className="secondary-button" type="button" onClick={() => onSelect("validity")}><Clock3 size={15} />时效</button>
          </>
        ) : (
          <>
            <button className="secondary-button" type="button" onClick={() => onSelect("templates")}><CalendarClock size={15} />模板</button>
            <button className="secondary-button" type="button" onClick={() => onSelect("inspector")}><Settings2 size={15} />检查</button>
          </>
        )}
      </div>
      {!adjustmentMode && temporaryAdjustment ? (
        <button className="danger-link overview-clear-adjustment" type="button" onClick={onClearAdjustment} disabled={clearingAdjustment}>
          <RotateCcw size={14} />{clearingAdjustment ? "处理中" : temporaryAdjustment.status === "active" ? "撤销本周调课" : "取消调课草稿"}
        </button>
      ) : null}
    </section>
  );
}

function ResizeHandle({
  side,
  width,
  onStart,
  onKeyboardResize,
}: {
  side: ResizeSide;
  width: number;
  onStart: (side: ResizeSide, clientX: number) => void;
  onKeyboardResize: (side: ResizeSide, delta: number) => void;
}) {
  const limits = RAIL_LIMITS[side];
  const label = side === "left" ? "调整左侧栏宽度" : "调整右侧栏宽度";
  return (
    <div
      className={`resize-handle resize-handle-${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        onStart(side, event.clientX);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 32 : 16;
        const direction = side === "left"
          ? event.key === "ArrowRight" ? step : -step
          : event.key === "ArrowLeft" ? step : -step;
        onKeyboardResize(side, direction);
      }}
    >
      <GripVertical size={16} aria-hidden="true" />
    </div>
  );
}

function SubjectTile({ code, name, compact = false }: { code: string; name: string; compact?: boolean }) {
  const parts = parseSubjectCode(code);
  return (
    <span className={`subject-tile${compact ? " subject-tile-compact" : ""}`}>
      <span className="subject-code">
        <span className="subject-primary">{parts.primary}</span>
        {parts.mode === "composite" ? (
          <>
            <span className="subject-code-separator" aria-hidden="true">@</span>
            <span className="subject-secondary">{parts.secondary}</span>
          </>
        ) : null}
      </span>
      <span className="subject-name">{name}</span>
    </span>
  );
}

function DraggableSubject({
  code,
  name,
  onAdd,
}: {
  code: string;
  name: string;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `subject:${code}` });
  return (
    <div
      ref={setNodeRef}
      className={`library-subject${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="drag-grip" size={15} aria-hidden="true" />
      <SubjectTile code={code} name={name} compact />
      <button
        className="mini-button"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
      >
        添加
      </button>
    </div>
  );
}

function CourseCell({
  id,
  code,
  name,
  rotated,
  adjustmentNote,
  adjustmentTargetName,
  selected,
  onSelect,
}: {
  id: string;
  code: string;
  name: string;
  rotated: boolean;
  adjustmentNote?: string;
  adjustmentTargetName?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const draggable = useDraggable({ id });
  const droppable = useDroppable({ id });
  const setRefs = useCallback(
    (node: HTMLElement | null) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    [draggable, droppable],
  );
  const transform = CSS.Translate.toString(draggable.transform);
  const adjusted = Boolean(adjustmentNote);
  return (
    <button
      ref={setRefs}
      type="button"
      className={`course-cell${selected ? " is-selected" : ""}${adjusted ? " is-adjusted" : ""}${draggable.isDragging ? " is-dragging" : ""}${droppable.isOver ? " is-over" : ""}`}
      style={{ transform }}
      onClick={onSelect}
      title={adjustmentNote}
      {...draggable.attributes}
      {...draggable.listeners}
      aria-label={`${name} ${code}${rotated ? "，四周轮换" : ""}${adjustmentNote ? `，${adjustmentNote}` : ""}`}
      aria-pressed={selected}
      aria-roledescription="可拖动课程"
    >
      <SubjectTile code={code} name={name} />
      {adjusted ? (
        <>
          <span className="adjustment-badge" aria-hidden="true"><CalendarClock size={11} />暂调</span>
          <span className="adjustment-target" aria-hidden="true">调至 {adjustmentTargetName}</span>
        </>
      ) : null}
      {rotated ? <span className="rotation-mark" title="四周轮换">4W</span> : null}
    </button>
  );
}

function TemplatePanel({
  config,
  activeTemplate,
  setActiveTemplate,
  commit,
  announce,
}: {
  config: ScheduleConfig;
  activeTemplate: string;
  setActiveTemplate: (name: string) => void;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
}) {
  const templateNames = Object.keys(config.timetable);
  const rows = getTemplateRows(config, activeTemplate);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [renameValue, setRenameValue] = useState(activeTemplate);
  const [newTimeRange, setNewTimeRange] = useState("11:00-11:39");
  const [newRowKind, setNewRowKind] = useState<"class" | "event">("class");
  const [newEventLabel, setNewEventLabel] = useState("课间");
  const [autoArrangeOpen, setAutoArrangeOpen] = useState(false);
  const [autoArrangeForm, setAutoArrangeForm] = useState<AutoArrangeFormState>(() => autoArrangeFormState(inferAutoArrangeOptions(config, activeTemplate)));

  function selectTemplate(name: string) {
    setActiveTemplate(name);
    setRenameValue(name);
  }

  function handleAddTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newTemplateName.trim();
    if (!name) return announce("请输入日程模板名称");
    if (templateNames.includes(name)) return announce("日程模板名称不能重复");
    commit((current) => addTemplate(current, name, PLACEHOLDER_SUBJECT_CODE), `已新增模板 ${name}`);
    selectTemplate(name);
    setNewTemplateName("");
  }

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = renameValue.trim();
    if (!name || name === activeTemplate) return;
    if (templateNames.includes(name)) return announce("日程模板名称不能重复");
    commit((current) => renameTemplate(current, activeTemplate, name), `已将模板重命名为 ${name}`);
    setActiveTemplate(name);
  }

  function handleAddRow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseTimeRange(newTimeRange);
    if (!parsed || parsed.start >= parsed.end) return announce("请选择有效的开始和结束时间，结束时间需要晚于开始时间");
    if (rows.some((row) => row.timeRange === newTimeRange)) return announce("该时间段已经存在");
    if (overlapsTimeRange(rows, newTimeRange)) return announce("该时间段与现有时间行重叠");
    commit(
      (current) =>
        addTemplateRow(
          current,
          activeTemplate,
          newRowKind === "class"
            ? { timeRange: newTimeRange, kind: "class", divider: false }
            : { timeRange: newTimeRange, kind: "event", eventLabel: newEventLabel },
          PLACEHOLDER_SUBJECT_CODE,
        ),
      newRowKind === "class" ? "已新增课程时间段" : "已新增事件时间段",
    );
    setNewTimeRange("11:00-11:39");
  }

  const autoArrangeOptions = useMemo(() => autoArrangeOptionsFromForm(autoArrangeForm), [autoArrangeForm]);
  const autoArrangeState = useMemo(() => {
    try {
      return { preview: previewAutoArrange(config, activeTemplate, autoArrangeOptions), error: "" };
    } catch (error) {
      return { preview: null, error: errorMessage(error) };
    }
  }, [activeTemplate, autoArrangeOptions, config]);

  function updateAutoArrangeField<Key extends keyof AutoArrangeFormState>(key: Key, value: AutoArrangeFormState[Key]) {
    setAutoArrangeForm((current) => ({ ...current, [key]: value }));
  }

  function handleApplyAutoArrange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!autoArrangeState.preview) {
      if (autoArrangeState.error) announce(autoArrangeState.error);
      return;
    }
    commit(
      (current) => applyAutoArrange(current, activeTemplate, autoArrangeOptions, PLACEHOLDER_SUBJECT_CODE),
      `已自动编排 ${activeTemplate} 的 ${autoArrangeOptions.classCount} 节课程`,
    );
  }

  const usageCount = config.daily_class.filter((day) => day.timetable === activeTemplate).length;

  return (
    <section className="panel-section panel-templates">
      <div className="section-heading">
        <div>
          <p className="section-kicker">TEMPLATES</p>
          <h2>日程模板</h2>
        </div>
        <CalendarClock size={18} aria-hidden="true" />
      </div>

      <div className="template-list" role="list" aria-label="日程模板">
        {templateNames.map((name) => (
          <button
            key={name}
            className={`template-option${name === activeTemplate ? " is-active" : ""}`}
            type="button"
            onClick={() => selectTemplate(name)}
          >
            <span>{name}</span>
            <span className="template-count">{getTemplateCourseCount(config, name)} 节</span>
          </button>
        ))}
      </div>

      <form className="compact-form" onSubmit={handleAddTemplate}>
        <label htmlFor="new-template">新模板</label>
        <div className="input-action-row">
          <input id="new-template" value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value)} placeholder="例如 holiday" />
          <button className="icon-button icon-button-accent" type="submit" aria-label="新增模板" title="新增模板">
            <Plus size={16} />
          </button>
        </div>
      </form>

      <form className="compact-form" onSubmit={handleRename}>
        <label htmlFor="rename-template">重命名当前模板</label>
        <div className="input-action-row">
          <input id="rename-template" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          <button className="icon-button" type="submit" aria-label="保存模板名称" title="保存模板名称">
            <Check size={16} />
          </button>
        </div>
      </form>

      <div className="panel-divider" />

      <div className="subsection-heading">
        <div>
          <span className="section-kicker">{activeTemplate}</span>
          <h3>时间行</h3>
        </div>
        <span className="muted-text">{usageCount} 天使用</span>
      </div>

      <div className="template-rows">
        {rows.map((row) => (
          <div className={`template-row${row.kind === "event" ? " is-event" : ""}`} key={row.timeRange}>
            <div className="template-row-topline">
              <span className="row-kind">{row.kind === "class" ? `第 ${(row.classIndex ?? 0) + 1} 节` : "事件"}</span>
              <button
                className="icon-button icon-button-subtle"
                type="button"
                aria-label={`删除 ${formatTimeRange(row.timeRange)}`}
                title="删除时间行"
                onClick={() => commit((current) => removeTemplateRow(current, activeTemplate, row.timeRange, PLACEHOLDER_SUBJECT_CODE), "已删除时间行，可用撤销恢复")}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <TimeRangeFields
              value={row.timeRange}
              onInvalid={() => announce("请选择有效的开始和结束时间，结束时间需要晚于开始时间")}
              onCommit={(value) => {
                if (rows.some((other) => other.timeRange === value && other.timeRange !== row.timeRange)) return announce("该时间段已经存在");
                if (overlapsTimeRange(rows, value, row.timeRange)) return announce("该时间段与现有时间行重叠");
                commit((current) => updateTemplateRow(current, activeTemplate, row.timeRange, { timeRange: value }, PLACEHOLDER_SUBJECT_CODE), "已更新时间段");
              }}
            />
            {row.kind === "event" ? (
              <input
                className="row-event-input"
                aria-label="事件名称"
                defaultValue={row.eventLabel}
                onBlur={(event) => commit((current) => updateTemplateRow(current, activeTemplate, row.timeRange, { eventLabel: event.target.value }, PLACEHOLDER_SUBJECT_CODE), "已更新事件名称")}
              />
            ) : (
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={Boolean(row.divider)}
                  onChange={(event) => commit((current) => setTemplateDivider(current, activeTemplate, row.classIndex ?? 0, event.target.checked), "已更新分隔线")}
                />
                <span>课后分隔线</span>
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="auto-arrange-tool">
        <button
          className="secondary-button full-width auto-arrange-toggle"
          type="button"
          aria-expanded={autoArrangeOpen}
          aria-controls="auto-arrange-form"
          onClick={() => setAutoArrangeOpen((current) => !current)}
        >
          <Sparkles size={15} />
          <span>自动编排</span>
          <ChevronDown className={autoArrangeOpen ? "is-rotated" : ""} size={15} />
        </button>

        {autoArrangeOpen ? (
          <form id="auto-arrange-form" className="auto-arrange-form" onSubmit={handleApplyAutoArrange}>
            <div className="subsection-heading subsection-heading-tight">
              <div>
                <span className="section-kicker">CONTINUOUS BLOCK</span>
                <h3>生成连续区段</h3>
              </div>
              <Sparkles size={15} aria-hidden="true" />
            </div>
            <div className="form-grid-two">
              <label htmlFor="auto-arrange-start">
                起始时间
                <input
                  id="auto-arrange-start"
                  type="time"
                  value={autoArrangeForm.startTime}
                  step="60"
                  onChange={(event) => updateAutoArrangeField("startTime", event.target.value)}
                />
              </label>
              <label htmlFor="auto-arrange-count">
                连续节数
                <input
                  id="auto-arrange-count"
                  type="number"
                  min="1"
                  step="1"
                  value={autoArrangeForm.classCount}
                  onChange={(event) => updateAutoArrangeField("classCount", event.target.value)}
                />
              </label>
              <label htmlFor="auto-arrange-class-duration">
                每节课程（分钟）
                <input
                  id="auto-arrange-class-duration"
                  type="number"
                  min="1"
                  step="1"
                  value={autoArrangeForm.classDurationMinutes}
                  onChange={(event) => updateAutoArrangeField("classDurationMinutes", event.target.value)}
                />
              </label>
              <label htmlFor="auto-arrange-break-duration">
                课间（分钟）
                <input
                  id="auto-arrange-break-duration"
                  type="number"
                  min="0"
                  step="1"
                  value={autoArrangeForm.breakDurationMinutes}
                  onChange={(event) => updateAutoArrangeField("breakDurationMinutes", event.target.value)}
                />
              </label>
            </div>
            <label htmlFor="auto-arrange-break-label">
              课间名称
              <input
                id="auto-arrange-break-label"
                value={autoArrangeForm.breakLabel}
                onChange={(event) => updateAutoArrangeField("breakLabel", event.target.value)}
              />
            </label>
            <label className="checkbox-line" htmlFor="auto-arrange-divider">
              <input
                id="auto-arrange-divider"
                type="checkbox"
                checked={autoArrangeForm.dividerAfterBlock}
                onChange={(event) => updateAutoArrangeField("dividerAfterBlock", event.target.checked)}
              />
              <span>区段末尾添加分隔线</span>
            </label>

            {autoArrangeState.error ? <p className="auto-arrange-error" role="alert">{autoArrangeState.error}</p> : null}
            {autoArrangeState.preview ? (
              <div className="auto-arrange-preview" data-testid="auto-arrange-preview">
                <div className="auto-arrange-summary">
                  <span><strong>{autoArrangeState.preview.rows.filter((row) => row.kind === "class").length}</strong> 节课程</span>
                  <span>结束于 <strong>{formatMinutesOfDay(autoArrangeState.preview.endMinutes)}</strong></span>
                </div>
                <div className="auto-arrange-row-list" aria-label="自动编排预览">
                  {autoArrangeState.preview.rows.map((row) => (
                    <div className={`auto-arrange-preview-row${row.kind === "event" ? " is-event" : ""}`} key={row.timeRange}>
                      <span>{formatTimeRange(row.timeRange)}</span>
                      <strong>{row.kind === "event" ? row.eventLabel : "课程"}</strong>
                    </div>
                  ))}
                </div>
                <div className="auto-arrange-impact">
                  <span>保留课程 {autoArrangeState.preview.preservedCourseCount} 节</span>
                  <span>新增待安排 {autoArrangeState.preview.addedPlaceholderCount} 节</span>
                  {autoArrangeState.preview.discardedCourseCount > 0 ? <span className="auto-arrange-impact-warning">将移除课程 {autoArrangeState.preview.discardedCourseCount} 节</span> : null}
                </div>
                {autoArrangeState.preview.replacedRows.length ? (
                  <div className="auto-arrange-replaced">
                    <strong>将覆盖 {autoArrangeState.preview.replacedRows.length} 行</strong>
                    <ul>
                      {autoArrangeState.preview.replacedRows.map((row) => (
                        <li key={row.timeRange}>
                          <span>{formatTimeRange(row.timeRange)}</span>
                          <span>{row.kind === "event" ? row.eventLabel : `第 ${(row.classIndex ?? 0) + 1} 节课程`}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <p className="muted-text">当前区段不会覆盖已有时间行</p>}
                <button className="primary-button full-width" type="submit"><Sparkles size={15} />应用到当前模板</button>
              </div>
            ) : null}
          </form>
        ) : null}
      </div>

      <form className="add-row-form" onSubmit={handleAddRow}>
        <div className="subsection-heading subsection-heading-tight">
          <h3>添加时间行</h3>
          <Plus size={15} />
        </div>
        <div className="form-grid-two">
          <div className="new-time-field">
            <span className="field-label">时间段</span>
            <TimeRangeFields value={newTimeRange} onChange={setNewTimeRange} />
          </div>
          <label>
            类型
            <select value={newRowKind} onChange={(event) => setNewRowKind(event.target.value as "class" | "event")}>
              <option value="class">课程</option>
              <option value="event">事件</option>
            </select>
          </label>
        </div>
        {newRowKind === "event" ? (
          <label>
            事件名称
            <input value={newEventLabel} onChange={(event) => setNewEventLabel(event.target.value)} />
          </label>
        ) : null}
        <button className="secondary-button full-width" type="submit"><Plus size={15} />添加时间行</button>
      </form>

      {usageCount === 0 ? (
        <button
          className="danger-link"
          type="button"
          onClick={() => {
            commit((current) => removeTemplate(current, activeTemplate), `已删除模板 ${activeTemplate}`);
            setActiveTemplate(templateNames.find((name) => name !== activeTemplate) ?? "workday");
          }}
        >
          <Trash2 size={14} />删除未使用模板
        </button>
      ) : null}
    </section>
  );
}

type SubjectFormField = "primaryCode" | "secondaryCode" | "name";

type SubjectFormState = {
  mode: SubjectEntryMode;
  primaryCode: string;
  secondaryCode: string;
  name: string;
};

type SubjectFormErrors = SubjectCodeFieldErrors & {
  name?: string;
  duplicate?: string;
};

function SubjectModeControl({
  mode,
  idPrefix,
  onChange,
}: {
  mode: SubjectEntryMode;
  idPrefix: string;
  onChange: (mode: SubjectEntryMode) => void;
}) {
  const modes: Array<{ value: SubjectEntryMode; label: string; example: string; icon: React.ReactNode }> = [
    { value: "simple", label: "普通课程", example: "物 → 物理", icon: <BookOpen size={14} aria-hidden="true" /> },
    { value: "composite", label: "组合课程", example: "自 @ 语 → 周测", icon: <GitCompareArrows size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="subject-mode-switch" role="radiogroup" aria-label="课程代码类型">
      {modes.map((item) => (
        <button
          key={item.value}
          id={`${idPrefix}-${item.value}`}
          className={`subject-mode-option${mode === item.value ? " is-active" : ""}`}
          type="button"
          role="radio"
          aria-checked={mode === item.value}
          title={`${item.label}，示例：${item.example}`}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function SubjectEntryFields({
  idPrefix,
  form,
  errors,
  suggestions,
  onChange,
  onModeChange,
}: {
  idPrefix: string;
  form: SubjectFormState;
  errors: SubjectFormErrors;
  suggestions: Array<[string, string]>;
  onChange: (field: SubjectFormField, value: string) => void;
  onModeChange: (mode: SubjectEntryMode) => void;
}) {
  const primaryId = `${idPrefix}-primary-code`;
  const secondaryId = `${idPrefix}-secondary-code`;
  const nameId = `${idPrefix}-name`;
  const suggestionsId = `${idPrefix}-code-suggestions`;
  const previewCode = form.mode === "composite"
    ? `${form.primaryCode.trim() || "第一段"}@${form.secondaryCode.trim() || "第二段"}`
    : form.primaryCode.trim() || "课程简称";

  function errorId(field: SubjectFormField) {
    return `${idPrefix}-${field}-error`;
  }

  return (
    <>
      <SubjectModeControl mode={form.mode} idPrefix={idPrefix} onChange={onModeChange} />

      {form.mode === "simple" ? (
        <div className="form-grid-two subject-simple-fields">
          <label htmlFor={primaryId}>
            <span>课程简称</span>
            <input
              id={primaryId}
              value={form.primaryCode}
              list={suggestionsId}
              placeholder="例如 物"
              aria-invalid={Boolean(errors.primary || errors.duplicate)}
              aria-describedby={errors.primary ? errorId("primaryCode") : undefined}
              onChange={(event) => onChange("primaryCode", event.target.value)}
            />
            {errors.primary ? <span id={errorId("primaryCode")} className="field-error" role="alert">{errors.primary}</span> : null}
          </label>
          <label htmlFor={nameId}>
            <span>显示名称</span>
            <input
              id={nameId}
              value={form.name}
              placeholder="例如 物理"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? errorId("name") : undefined}
              onChange={(event) => onChange("name", event.target.value)}
            />
            {errors.name ? <span id={errorId("name")} className="field-error" role="alert">{errors.name}</span> : null}
          </label>
        </div>
      ) : (
        <>
          <div className="subject-code-pair">
            <label htmlFor={primaryId}>
              <span>第一段代码</span>
              <input
                id={primaryId}
                value={form.primaryCode}
                list={suggestionsId}
                placeholder="例如 自"
                aria-invalid={Boolean(errors.primary || errors.duplicate)}
                aria-describedby={errors.primary ? errorId("primaryCode") : undefined}
                onChange={(event) => onChange("primaryCode", event.target.value)}
              />
              {errors.primary ? <span id={errorId("primaryCode")} className="field-error" role="alert">{errors.primary}</span> : null}
            </label>
            <span className="subject-code-at" aria-hidden="true">@</span>
            <label htmlFor={secondaryId}>
              <span>第二段代码</span>
              <input
                id={secondaryId}
                value={form.secondaryCode}
                list={suggestionsId}
                placeholder="例如 语"
                aria-invalid={Boolean(errors.secondary || errors.duplicate)}
                aria-describedby={errors.secondary ? errorId("secondaryCode") : undefined}
                onChange={(event) => onChange("secondaryCode", event.target.value)}
              />
              {errors.secondary ? <span id={errorId("secondaryCode")} className="field-error" role="alert">{errors.secondary}</span> : null}
            </label>
          </div>
          <label htmlFor={nameId}>
            <span>显示名称</span>
            <input
              id={nameId}
              value={form.name}
              placeholder="例如 语文周测"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? errorId("name") : undefined}
              onChange={(event) => onChange("name", event.target.value)}
            />
            {errors.name ? <span id={errorId("name")} className="field-error" role="alert">{errors.name}</span> : null}
          </label>
        </>
      )}

      <datalist id={suggestionsId}>
        {suggestions.map(([subjectCode, subjectName]) => <option key={subjectCode} value={subjectCode} label={subjectName}>{subjectName}</option>)}
      </datalist>

      <output className="subject-code-preview" data-testid={`${idPrefix}-preview`} aria-label="课表效果" aria-live="polite">
        <span className="subject-preview-label">课表效果</span>
        <span className="subject-preview-tile">
          <SubjectTile code={previewCode} name={form.name.trim() || "课程名称"} compact />
        </span>
      </output>

      {errors.duplicate ? <p className="subject-form-error" role="alert">{errors.duplicate}</p> : null}
    </>
  );
}

function SubjectLibrary({
  config,
  commit,
  announce,
}: {
  config: ScheduleConfig;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
}) {
  const [addForm, setAddForm] = useState<SubjectFormState>({ mode: "simple", primaryCode: "", secondaryCode: "", name: "" });
  const [addErrors, setAddErrors] = useState<SubjectFormErrors>({});
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SubjectFormState>({ mode: "simple", primaryCode: "", secondaryCode: "", name: "" });
  const [editErrors, setEditErrors] = useState<SubjectFormErrors>({});
  const entries = Object.entries(config.subject_name);
  const codeSuggestions = entries.filter(([subjectCode]) => subjectCode !== PLACEHOLDER_SUBJECT_CODE && !subjectCode.includes("@"));

  function validateForm(form: SubjectFormState, currentCode?: string) {
    const errors: SubjectFormErrors = validateSubjectCodeFields(form.mode, form.primaryCode, form.secondaryCode);
    if (!form.name.trim()) errors.name = "请输入显示名称";
    const subjectCode = composeSubjectCode(form.mode, form.primaryCode, form.secondaryCode);
    if (!Object.keys(errors).length && config.subject_name[subjectCode] && subjectCode !== currentCode) {
      errors.duplicate = `课程代码 ${subjectCode} 已存在，请换一个代码或编辑已有课程`;
    }
    return { errors, subjectCode };
  }

  function updateAddForm(field: SubjectFormField, value: string) {
    setAddForm((current) => ({ ...current, [field]: value }));
    setAddErrors({});
  }

  function updateEditForm(field: SubjectFormField, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
    setEditErrors({});
  }

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { errors, subjectCode } = validateForm(addForm);
    if (Object.keys(errors).length) return setAddErrors(errors);
    commit((current) => addSubject(current, subjectCode, addForm.name), `已新增课程 ${subjectCode}`);
    announce(`添加成功：${addForm.name.trim()}（${subjectCode}）`);
    setAddForm((current) => ({ ...current, primaryCode: "", secondaryCode: "", name: "" }));
    setAddErrors({});
  }

  function startEdit(subjectCode: string, subjectName: string) {
    const parts = parseSubjectCode(subjectCode);
    setEditingCode(subjectCode);
    setEditForm({ mode: parts.mode, primaryCode: parts.primary, secondaryCode: parts.secondary, name: subjectName });
    setEditErrors({});
  }

  function saveEdit() {
    if (!editingCode) return;
    const { errors, subjectCode } = validateForm(editForm, editingCode);
    if (Object.keys(errors).length) return setEditErrors(errors);
    commit((current) => updateSubject(current, editingCode, subjectCode, editForm.name), `已更新课程 ${subjectCode}`);
    setEditingCode(null);
    setEditErrors({});
  }

  function deleteSubject(subjectCode: string) {
    if (subjectCode === PLACEHOLDER_SUBJECT_CODE) return announce("待安排占位课程不能删除");
    const references = subjectReferences(config, subjectCode);
    if (references.length) return announce(`${subjectCode} 正在使用：${references.slice(0, 3).join("、")}${references.length > 3 ? "等" : ""}`);
    commit((current) => {
      const next = JSON.parse(JSON.stringify(current)) as ScheduleConfig;
      delete next.subject_name[subjectCode];
      return next;
    }, `已删除课程 ${subjectCode}`);
  }

  return (
    <section className="panel-section panel-subjects">
      <div className="section-heading">
        <div>
          <p className="section-kicker">COURSES</p>
          <h2>课程库</h2>
        </div>
        <BookOpen size={18} aria-hidden="true" />
      </div>

      <form className="subject-add-form" data-testid="subject-add-form" onSubmit={handleAdd}>
        <SubjectEntryFields
          idPrefix="add-subject"
          form={addForm}
          errors={addErrors}
          suggestions={codeSuggestions}
          onChange={updateAddForm}
          onModeChange={(mode) => { setAddForm((current) => ({ ...current, mode })); setAddErrors({}); }}
        />
        <button className="secondary-button full-width" type="submit"><Plus size={15} />新增课程</button>
      </form>

      <div className="library-list-heading">
        <h3>已有课程</h3>
        <span>{entries.length} 项</span>
      </div>
      <div className="library-list">
        {entries.map(([subjectCode, subjectName]) => {
          const isEditing = editingCode === subjectCode;
          return (
            <div className={`library-row${isEditing ? " is-editing" : ""}`} data-subject-code={subjectCode} key={subjectCode}>
              {isEditing ? (
                <div className="library-edit-form">
                  <SubjectEntryFields
                    idPrefix="edit-subject"
                    form={editForm}
                    errors={editErrors}
                    suggestions={codeSuggestions}
                    onChange={updateEditForm}
                    onModeChange={(mode) => { setEditForm((current) => ({ ...current, mode })); setEditErrors({}); }}
                  />
                  <div className="inline-actions">
                    <button className="icon-button icon-button-accent" type="button" aria-label="保存课程" title="保存课程" onClick={saveEdit}><Check size={15} /></button>
                    <button className="icon-button" type="button" aria-label="取消编辑" title="取消编辑" onClick={() => { setEditingCode(null); setEditErrors({}); }}><X size={15} /></button>
                  </div>
                </div>
              ) : (
                <>
                  <SubjectTile code={subjectCode} name={subjectName} compact />
                  <div className="inline-actions">
                    <button className="icon-button icon-button-subtle" type="button" aria-label={`编辑 ${subjectCode}`} title="编辑课程" onClick={() => startEdit(subjectCode, subjectName)}><Pencil size={15} /></button>
                    <button className="icon-button icon-button-subtle" type="button" aria-label={`删除 ${subjectCode}`} title="删除课程" onClick={() => deleteSubject(subjectCode)}><Trash2 size={15} /></button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function InspectorPanel({
  config,
  selectedCell,
  weekIndex,
  adjustmentMode,
  setWeekIndex,
  commit,
  announce,
}: {
  config: ScheduleConfig;
  selectedCell: SelectedCell;
  weekIndex: number;
  adjustmentMode: boolean;
  setWeekIndex: (index: number) => void;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
}) {
  const [copyTarget, setCopyTarget] = useState<number>(weekIndex === 0 ? 1 : 0);
  const day = selectedCell ? config.daily_class[selectedCell.dayIndex] : null;
  const value = day && selectedCell ? day.classList[selectedCell.classIndex] : undefined;
  const currentCode = getCourseForWeek(value, weekIndex);
  const rotating = isRotatingCourse(value ?? "");
  const entries = Object.entries(config.subject_name);

  function selectCourse(code: string) {
    if (!selectedCell) return;
    commit(
      (current) => adjustmentMode
        ? setAdjustmentCourse(current, selectedCell.dayIndex, selectedCell.classIndex, weekIndex, code)
        : setDayCourse(current, selectedCell.dayIndex, selectedCell.classIndex, weekIndex, code),
      adjustmentMode ? "已更新本周临时课程" : "已更新课程",
    );
  }

  function toggleRotation() {
    if (!selectedCell || !day) return;
    const nextCode = getCourseForWeek(value, weekIndex);
    commit((current) => {
      const next = JSON.parse(JSON.stringify(current)) as ScheduleConfig;
      const selectedDay = next.daily_class[selectedCell.dayIndex];
      const existing = selectedDay.classList[selectedCell.classIndex];
      if (!Array.isArray(existing)) selectedDay.classList[selectedCell.classIndex] = [nextCode, nextCode, nextCode, nextCode];
      else selectedDay.classList[selectedCell.classIndex] = getCourseForWeek(existing, weekIndex);
      return next;
    }, Array.isArray(value) ? "已取消四周轮换" : "已开启四周轮换");
  }

  function copySelectedWeek() {
    if (!selectedCell) return announce("请先选择一个课程单元格");
    commit((current) => {
      const next = JSON.parse(JSON.stringify(current)) as ScheduleConfig;
      const selectedDay = next.daily_class[selectedCell.dayIndex];
      const selectedValue = selectedDay.classList[selectedCell.classIndex];
      if (!Array.isArray(selectedValue)) return next;
      selectedValue[copyTarget] = selectedValue[weekIndex] ?? selectedValue[selectedValue.length - 1];
      return next;
    }, `已将第 ${weekIndex + 1} 周复制到第 ${copyTarget + 1} 周`);
  }

  return (
    <section className="panel-section panel-inspector">
      <div className="section-heading">
        <div>
          <p className="section-kicker">INSPECTOR</p>
          <h2>课程检查器</h2>
        </div>
        <Settings2 size={18} aria-hidden="true" />
      </div>

      {adjustmentMode ? (
        <div className="adjustment-week-lock" role="status">
          <span>本次调课固定轮换周</span>
          <strong>第 {weekIndex + 1} 周</strong>
        </div>
      ) : (
        <div className="week-switcher" role="tablist" aria-label="轮换周次">
          {[0, 1, 2, 3].map((index) => (
            <button key={index} className={weekIndex === index ? "is-active" : ""} type="button" role="tab" aria-selected={weekIndex === index} onClick={() => setWeekIndex(index)}>
              第 {index + 1} 周
            </button>
          ))}
        </div>
      )}

      {selectedCell && day ? (
        <div className="inspector-content" key={`${selectedCell.dayIndex}-${selectedCell.classIndex}-${weekIndex}`}>
          <div className="selected-location">
            <span>{WEEKDAYS[selectedCell.dayIndex].Chinese} · 第 {selectedCell.classIndex + 1} 节</span>
            <span className="muted-text">{day.timetable}</span>
          </div>
          <label className="field-label" htmlFor="selected-course">课程</label>
          <select id="selected-course" value={currentCode} onChange={(event) => selectCourse(event.target.value)}>
            {entries.map(([subjectCode, subjectName]) => <option key={subjectCode} value={subjectCode}>{subjectCode} · {subjectName}</option>)}
          </select>
          {!adjustmentMode ? <div className="inspector-actions">
            <button className="secondary-button" type="button" onClick={toggleRotation}>{rotating ? "取消四周轮换" : "开启四周轮换"}</button>
          </div> : null}
          {rotating && !adjustmentMode ? (
            <>
              <div className="rotation-fields">
                {[0, 1, 2, 3].map((index) => (
                  <label key={index}>
                    第 {index + 1} 周
                    <select value={getCourseForWeek(value, index)} onChange={(event) => {
                      commit((current) => setDayCourse(current, selectedCell.dayIndex, selectedCell.classIndex, index, event.target.value), `已更新第 ${index + 1} 周课程`);
                    }}>
                      {entries.map(([subjectCode, subjectName]) => <option key={subjectCode} value={subjectCode}>{subjectCode} · {subjectName}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="copy-week-row">
                <select aria-label="目标周次" value={copyTarget} onChange={(event) => setCopyTarget(Number(event.target.value))}>
                  {[0, 1, 2, 3].filter((index) => index !== weekIndex).map((index) => <option key={index} value={index}>复制到第 {index + 1} 周</option>)}
                </select>
                <button className="icon-button" type="button" aria-label="复制周次" title="复制周次" onClick={copySelectedWeek}><ClipboardCopy size={16} /></button>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="empty-panel">
          <LayoutGrid size={22} />
          <p>选择一个课程单元格</p>
          <span>点击或拖动课程后，在这里编辑名称和轮换周次。</span>
        </div>
      )}
    </section>
  );
}

function StylePanel({
  config,
  commit,
  announce,
}: {
  config: ScheduleConfig;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
}) {
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [usingDefaultStyles, setUsingDefaultStyles] = useState(() => Object.keys(config.css_style).length === 0);
  const customStyleBackupRef = useRef<Record<string, string> | null>(null);
  const knownKeys = new Set(STYLE_FIELDS.map((field) => field.key));
  const customStyles = Object.entries(config.css_style).filter(([key]) => !knownKeys.has(key));
  const countdownHidden = config.countdown_target === "hidden";

  function setCountdownTarget(hidden: boolean) {
    commit((current) => {
      const next = JSON.parse(JSON.stringify(current)) as ScheduleConfig;
      if (hidden) {
        next.countdown_target = "hidden";
      } else if (next.countdown_target === "hidden") {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");
        next.countdown_target = `${year}-${month}-${day}`;
      }
      return next;
    });
  }

  function setCountdownDate(value: string) {
    if (!value) return announce("请选择倒计时目标日期，或勾选隐藏倒计时");
    commit((current) => ({ ...current, countdown_target: value }), "已更新倒计时目标");
  }

  function setWeekDisplay(display: boolean) {
    commit((current) => ({ ...current, week_display: display }), "已更新星期显示");
  }

  function setStyle(key: string, value: string) {
    commit((current) => {
      const next = JSON.parse(JSON.stringify(current)) as ScheduleConfig;
      if (value.trim()) next.css_style[key] = value;
      else delete next.css_style[key];
      return next;
    });
  }

  function setDefaultStyles(enabled: boolean) {
    setUsingDefaultStyles(enabled);
    if (enabled) {
      customStyleBackupRef.current = { ...config.css_style };
      commit((current) => ({ ...current, css_style: {} }), "已切换为客户端默认样式");
      return;
    }

    const backup = customStyleBackupRef.current;
    if (backup && Object.keys(backup).length > 0) {
      commit((current) => ({ ...current, css_style: { ...backup } }), "已恢复自定义样式");
    }
  }

  function addCustomStyle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = customKey.trim();
    if (!/^--[a-zA-Z0-9_-]+$/.test(key)) return announce("自定义属性名必须以 -- 开头，只能包含字母、数字、下划线或短横线");
    if (!customValue.trim()) return announce("自定义属性值不能为空");
    setStyle(key, customValue);
    setCustomKey("");
    setCustomValue("");
  }

  return (
    <section className="panel-section panel-style">
      <div className="section-heading">
        <div>
          <p className="section-kicker">APPEARANCE</p>
          <h2>客户端样式</h2>
        </div>
        <Palette size={18} aria-hidden="true" />
      </div>
      <div className="config-settings">
        <div className="subsection-heading subsection-heading-tight">
          <h3>倒计时与星期</h3>
          <CalendarClock size={15} aria-hidden="true" />
        </div>
        <label className="date-field">
          目标日期
          <input
            type="date"
            value={countdownHidden ? "" : config.countdown_target}
            disabled={countdownHidden}
            onChange={(event) => setCountdownDate(event.target.value)}
          />
        </label>
        <label className="checkbox-line config-checkbox">
          <input type="checkbox" checked={countdownHidden} onChange={(event) => setCountdownTarget(event.target.checked)} />
          <span>隐藏目标倒计时</span>
        </label>
        <label className="checkbox-line config-checkbox">
          <input type="checkbox" checked={config.week_display} onChange={(event) => setWeekDisplay(event.target.checked)} />
          <span>显示星期信息</span>
        </label>
      </div>
      <div className="panel-divider" />
      <label className="checkbox-line config-checkbox style-default-toggle">
        <input type="checkbox" checked={usingDefaultStyles} onChange={(event) => setDefaultStyles(event.target.checked)} />
        <span>使用默认样式（不自定义）</span>
      </label>
      <p className={`panel-help style-default-help${usingDefaultStyles ? "" : " is-hidden"}`} aria-hidden={!usingDefaultStyles}>
        当前使用客户端默认样式。
      </p>
      <div
        className={`style-customization${usingDefaultStyles ? " is-hidden" : ""}`}
        aria-hidden={usingDefaultStyles}
        inert={usingDefaultStyles ? true : undefined}
      >
        <div className="style-customization-inner">
          <p className="panel-help">这些变量会原样写入 Electron 配置。当前客户端只会使用它 CSS 中已定义的变量。</p>
          <div className="style-fields">
            {STYLE_FIELDS.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input value={config.css_style[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setStyle(field.key, event.target.value)} />
              </label>
            ))}
          </div>
          <div className="panel-divider" />
          <div className="subsection-heading subsection-heading-tight">
            <h3>高级变量</h3>
            <span className="muted-text">--custom-property</span>
          </div>
          <form className="custom-style-form" onSubmit={addCustomStyle}>
            <input value={customKey} onChange={(event) => setCustomKey(event.target.value)} placeholder="--my-variable" aria-label="自定义属性名" />
            <input value={customValue} onChange={(event) => setCustomValue(event.target.value)} placeholder="属性值" aria-label="自定义属性值" />
            <button className="icon-button icon-button-accent" type="submit" aria-label="添加自定义变量" title="添加自定义变量"><Plus size={16} /></button>
          </form>
          <div className="custom-style-list">
            {customStyles.map(([key, value]) => (
              <div className="custom-style-row" key={key}>
                <code>{key}</code>
                <input value={value} onChange={(event) => setStyle(key, event.target.value)} aria-label={`${key} 的值`} />
                <button className="icon-button icon-button-subtle" type="button" aria-label={`删除 ${key}`} title="删除变量" onClick={() => setStyle(key, "")}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PreviewPanel({ config, dayIndex, weekIndex }: { config: ScheduleConfig; dayIndex: number; weekIndex: number }) {
  const day = config.daily_class[dayIndex];
  const rows = day ? getTemplateRows(config, day.timetable) : [];
  const previewStyle = {
    "--preview-radius": config.css_style["--global-border-radius"] ?? "4px",
    "--preview-font-size": config.css_style["--center-font-size"] ?? "16px",
    "--preview-sub-font-size": config.css_style["--sub-font-size"] ?? "11px",
  } as React.CSSProperties;
  return (
    <section className="panel-section panel-preview">
      <div className="section-heading">
        <div>
          <p className="section-kicker">PREVIEW</p>
          <h2>客户端预览</h2>
        </div>
        <span className="preview-live-dot" title="预览使用当前草稿">LIVE</span>
      </div>
      <div className="preview-surface" key={`${dayIndex}-${weekIndex}`} style={previewStyle}>
        <div className="preview-meta">
          <span>{day ? `${day.Chinese} · ${day.English}` : "未选择日期"}</span>
          <span>第 {weekIndex + 1} 周</span>
        </div>
        <div className="preview-list">
          {rows.map((row) => {
            if (row.kind === "event") return <div className="preview-event" key={row.timeRange}><span>{formatTimeRange(row.timeRange)}</span><strong>{row.eventLabel}</strong></div>;
            const code = getCourseForWeek(day?.classList[row.classIndex ?? 0], weekIndex);
            return <div className="preview-class" key={row.timeRange}><span>{formatTimeRange(row.timeRange)}</span><SubjectTile code={code} name={config.subject_name[code] ?? "待安排"} compact /></div>;
          })}
        </div>
        <div className="preview-footer">
          <span>{config.countdown_target === "hidden" ? "倒计时已隐藏" : `倒计时目标 ${config.countdown_target}`}</span>
          <span>{config.week_display ? "显示星期" : "隐藏星期"}</span>
        </div>
      </div>
    </section>
  );
}

function MatrixHeader({
  config,
  activeTemplate,
  adjustmentMode,
  selectedDay,
  setSelectedDay,
  setActiveTemplate,
  commit,
  announce,
}: {
  config: ScheduleConfig;
  activeTemplate: string;
  adjustmentMode: boolean;
  selectedDay: number;
  setSelectedDay: (index: number) => void;
  setActiveTemplate: (name: string) => void;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
}) {
  const templateNames = Object.keys(config.timetable);
  return (
    <div className="matrix-header">
      <div className="matrix-label-cell"><span>节次</span><small>{activeTemplate}</small></div>
      {config.daily_class.map((day, dayIndex) => (
        <div className={`day-header${selectedDay === dayIndex ? " is-selected" : ""}`} key={dayIndex}>
          <button type="button" onClick={() => { setSelectedDay(dayIndex); setActiveTemplate(day.timetable); }}>
            <strong>{day.Chinese}</strong>
            <span>{day.English}</span>
          </button>
          {adjustmentMode ? (
            <span className="day-header-lock">本周锁定</span>
          ) : (
            <select
              aria-label={`星期${day.Chinese}使用的日程模板`}
              value={day.timetable}
              onChange={(event) => {
                const templateName = event.target.value;
                if (!templateNames.includes(templateName)) return announce("日程模板不存在");
                setSelectedDay(dayIndex);
                setActiveTemplate(templateName);
                commit((current) => assignDayTemplate(current, dayIndex, templateName, PLACEHOLDER_SUBJECT_CODE), `星期${day.Chinese}已切换到 ${templateName}`);
              }}
            >
              {templateNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

function MatrixRow({
  row,
  config,
  activeTemplate,
  selectedDay,
  adjustmentCells,
  selectedCell,
  onSelect,
  weekIndex,
}: {
  row: TemplateRow;
  config: ScheduleConfig;
  activeTemplate: string;
  selectedDay: number;
  adjustmentCells: Map<string, AdjustmentCellDisplay>;
  selectedCell: SelectedCell;
  onSelect: (dayIndex: number, classIndex: number) => void;
  weekIndex: number;
}) {
  return (
    <div className={`matrix-row${row.kind === "event" ? " matrix-row-event" : ""}`}>
      <div className="matrix-label-cell">
        <strong>{row.kind === "class" ? `第 ${(row.classIndex ?? 0) + 1} 节` : "事件"}</strong>
        <span>{formatTimeRange(row.timeRange)}</span>
      </div>
      {config.daily_class.map((day, dayIndex) => {
        if (day.timetable !== activeTemplate) {
          return <div className="disabled-cell" key={dayIndex}><span>{day.timetable}</span></div>;
        }
        if (row.kind === "event") return <div className="event-cell" key={dayIndex}><span>{row.eventLabel}</span></div>;
        const classIndex = row.classIndex ?? 0;
        const value = day.classList[classIndex];
        const code = getCourseForWeek(value, weekIndex);
        return (
          <CourseCell
            key={dayIndex}
            id={`cell:desktop:${dayIndex}:${classIndex}`}
            code={code}
            name={config.subject_name[code] ?? PLACEHOLDER_SUBJECT_NAME}
            rotated={isRotatingCourse(value ?? "")}
            adjustmentNote={adjustmentCells.get(`${dayIndex}:${classIndex}`)?.note}
            adjustmentTargetName={adjustmentCells.get(`${dayIndex}:${classIndex}`)?.targetName}
            selected={selectedCell?.dayIndex === dayIndex && selectedCell.classIndex === classIndex}
            onSelect={() => onSelect(dayIndex, classIndex)}
          />
        );
      })}
    </div>
  );
}

function ScheduleMatrix({
  config,
  activeTemplate,
  adjustmentMode,
  adjustmentCells,
  selectedDay,
  setSelectedDay,
  setActiveTemplate,
  selectedCell,
  onSelect,
  commit,
  announce,
  weekIndex,
}: {
  config: ScheduleConfig;
  activeTemplate: string;
  adjustmentMode: boolean;
  adjustmentCells: Map<string, AdjustmentCellDisplay>;
  selectedDay: number;
  setSelectedDay: (index: number) => void;
  setActiveTemplate: (name: string) => void;
  selectedCell: SelectedCell;
  onSelect: (dayIndex: number, classIndex: number) => void;
  commit: (updater: ConfigUpdater, message?: string) => void;
  announce: (message: string) => void;
  weekIndex: number;
}) {
  const rows = getTemplateRows(config, activeTemplate);
  const selectedRows = getTemplateRows(config, config.daily_class[selectedDay]?.timetable ?? activeTemplate);
  return (
    <section className="panel-section panel-schedule">
      <div className="section-heading schedule-heading">
        <div>
          <p className="section-kicker">WEEKLY BOARD</p>
          <h2>星期矩阵</h2>
        </div>
        <div className="schedule-heading-meta">
          <span>正在编辑第 {weekIndex + 1} 周</span>
          <span>{getClassRows(config, activeTemplate).length} 个课程槽</span>
        </div>
      </div>
      <div className="schedule-board" key={`${activeTemplate}-${selectedDay}-${weekIndex}`}>
        <div className="mobile-day-tabs" role="tablist" aria-label="选择星期">
          {WEEKDAYS.map((day, index) => <button key={day.English} className={selectedDay === index ? "is-active" : ""} type="button" role="tab" aria-selected={selectedDay === index} onClick={() => { setSelectedDay(index); setActiveTemplate(config.daily_class[index]?.timetable ?? activeTemplate); }}>{day.Chinese}</button>)}
        </div>
        <div className="desktop-matrix" aria-label="星期课程矩阵">
          <MatrixHeader config={config} activeTemplate={activeTemplate} adjustmentMode={adjustmentMode} selectedDay={selectedDay} setSelectedDay={setSelectedDay} setActiveTemplate={setActiveTemplate} commit={commit} announce={announce} />
          {rows.map((row) => <MatrixRow key={row.timeRange} row={row} config={config} activeTemplate={activeTemplate} selectedDay={selectedDay} adjustmentCells={adjustmentCells} selectedCell={selectedCell} onSelect={onSelect} weekIndex={weekIndex} />)}
        </div>
        <div className="mobile-matrix" aria-label="移动端课程矩阵">
          <div className="mobile-matrix-header">
            <div><strong>{WEEKDAYS[selectedDay].Chinese}</strong><span>{WEEKDAYS[selectedDay].English}</span></div>
            {adjustmentMode ? (
              <span className="day-header-lock">本周锁定</span>
            ) : (
              <select
                value={config.daily_class[selectedDay]?.timetable ?? activeTemplate}
                onChange={(event) => { setActiveTemplate(event.target.value); commit((current) => assignDayTemplate(current, selectedDay, event.target.value, PLACEHOLDER_SUBJECT_CODE), `星期${WEEKDAYS[selectedDay].Chinese}已切换模板`); }}
                aria-label="移动端日程模板"
              >
                {Object.keys(config.timetable).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
          </div>
          {selectedRows.map((row) => {
            if (row.kind === "event") return <div className="mobile-row mobile-row-event" key={row.timeRange}><span>{formatTimeRange(row.timeRange)}</span><strong>{row.eventLabel}</strong></div>;
            const classIndex = row.classIndex ?? 0;
            const value = config.daily_class[selectedDay]?.classList[classIndex];
            const code = getCourseForWeek(value, weekIndex);
            const adjustment = adjustmentCells.get(`${selectedDay}:${classIndex}`);
            return <div className="mobile-row" key={row.timeRange}><span>{formatTimeRange(row.timeRange)}</span><CourseCell id={`cell:mobile:${selectedDay}:${classIndex}`} code={code} name={config.subject_name[code] ?? PLACEHOLDER_SUBJECT_NAME} rotated={isRotatingCourse(value ?? "")} adjustmentNote={adjustment?.note} adjustmentTargetName={adjustment?.targetName} selected={selectedCell?.dayIndex === selectedDay && selectedCell.classIndex === classIndex} onSelect={() => onSelect(selectedDay, classIndex)} /></div>;
          })}
        </div>
      </div>
      <p className="matrix-hint"><GripVertical size={14} />{adjustmentMode ? "拖动课程到另一个单元格即可交换本周安排。" : "拖动课程到另一个单元格即可交换；从左侧课程库拖入可替换课程。"}</p>
    </section>
  );
}

export function EditorApp({ user }: { user: PublicUser }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [publishedConfig, setPublishedConfig] = useState<ScheduleConfig | null>(null);
  const [temporaryAdjustment, setTemporaryAdjustment] = useState<ScheduleAdjustmentView | null>(null);
  const [temporaryAdjustmentVersion, setTemporaryAdjustmentVersion] = useState(0);
  const [currentWeek, setCurrentWeek] = useState<ScheduleWeekWindow>(() => getScheduleWeekWindow());
  const [isAdjustmentMode, setIsAdjustmentMode] = useState(false);
  const [isEnteringAdjustmentMode, setIsEnteringAdjustmentMode] = useState(false);
  const [adjustmentConfig, setAdjustmentConfig] = useState<ScheduleConfig | null>(null);
  const [adjustmentWeekIndex, setAdjustmentWeekIndex] = useState<number | null>(null);
  const [adjustmentSourceDraftVersion, setAdjustmentSourceDraftVersion] = useState(1);
  const [adjustmentDirty, setAdjustmentDirty] = useState(false);
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);
  const [isClearingAdjustment, setIsClearingAdjustment] = useState(false);
  const [previousPublishedConfig, setPreviousPublishedConfig] = useState<ScheduleConfig | null>(null);
  const [draftVersion, setDraftVersion] = useState(1);
  const [publishedVersion, setPublishedVersion] = useState(1);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeTemplate, setActiveTemplate] = useState("workday");
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("schedule");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>("diff");
  const [revisions, setRevisions] = useState<ScheduleRevisionView[]>([]);
  const [revisionsState, setRevisionsState] = useState<RevisionLoadState>("idle");
  const [revisionNote, setRevisionNote] = useState("");
  const [isCreatingRevision, setIsCreatingRevision] = useState(false);
  const [restoringRevisionId, setRestoringRevisionId] = useState<number | null>(null);
  const [conflictCurrent, setConflictCurrent] = useState<ScheduleDocumentView | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const [leftRailWidth, setLeftRailWidth] = useState(288);
  const [resizeSide, setResizeSide] = useState<ResizeSide | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastConfigRef = useRef<ScheduleConfig | null>(null);
  const undoConfigRef = useRef<ScheduleConfig | null>(null);
  const adjustmentUndoConfigRef = useRef<ScheduleConfig | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeStartRef = useRef<{ side: ResizeSide; clientX: number; width: number } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useScrollbarActivity();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const applyScheduleView = useCallback((data: ScheduleDocumentView) => {
    setConfig(data.draftConfig);
    setPublishedConfig(data.publishedConfig);
    setTemporaryAdjustment(data.temporaryAdjustment);
    setTemporaryAdjustmentVersion(data.temporaryAdjustmentVersion);
    setCurrentWeek(data.currentWeek);
    setIsAdjustmentMode(false);
    setIsEnteringAdjustmentMode(false);
    setAdjustmentConfig(null);
    setAdjustmentWeekIndex(null);
    setAdjustmentDirty(false);
    adjustmentUndoConfigRef.current = null;
    setPreviousPublishedConfig(data.previousPublishedConfig);
    setDraftVersion(data.draftVersion);
    setPublishedVersion(data.publishedVersion);
    setPublishedAt(data.publishedAt);
    setDraftUpdatedAt(data.draftUpdatedAt ?? data.updatedAt);
    setActiveTemplate(data.draftConfig.daily_class[1]?.timetable ?? Object.keys(data.draftConfig.timetable)[0] ?? "workday");
    lastConfigRef.current = data.draftConfig;
    setDirty(false);
    setSaveState("saved");
  }, []);

  const loadSchedule = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/schedule", { cache: "no-store" });
      const data = await response.json() as ScheduleDocumentView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "无法读取课表");
      applyScheduleView(data);
      setLoadState("ready");
    } catch (error) {
      setLoadError(errorMessage(error));
      setLoadState("error");
    }
  }, [applyScheduleView]);

  useEffect(() => {
    // The fetch is the external synchronization point for this client component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    lastConfigRef.current = config;
  }, [config]);

  const adjustRailWidth = useCallback((side: ResizeSide, delta: number) => {
    const limits = RAIL_LIMITS[side];
    setLeftRailWidth((current) => Math.min(limits.max, Math.max(limits.min, current + delta)));
  }, []);

  const startRailResize = useCallback((side: ResizeSide, clientX: number) => {
    resizeStartRef.current = {
      side,
      clientX,
      width: leftRailWidth,
    };
    setResizeSide(side);
  }, [leftRailWidth]);

  useEffect(() => {
    if (!resizeSide) return;
    const onPointerMove = (event: PointerEvent) => {
      const session = resizeStartRef.current;
      if (!session) return;
      const delta = event.clientX - session.clientX;
      const limits = RAIL_LIMITS[session.side];
      const nextWidth = Math.min(limits.max, Math.max(limits.min, session.width + (session.side === "left" ? delta : -delta)));
      setLeftRailWidth(nextWidth);
    };
    const onPointerUp = () => {
      resizeStartRef.current = null;
      setResizeSide(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizeSide]);

  useEffect(() => {
    if (!isExportMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !exportMenuRef.current?.contains(event.target)) setIsExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExportMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isExportMenuOpen]);

  const loadRevisions = useCallback(async () => {
    setRevisionsState("loading");
    try {
      const response = await fetch("/api/schedule/revisions", { cache: "no-store" });
      const data = await response.json() as { revisions?: ScheduleRevisionView[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "无法读取版本历史");
      setRevisions(data.revisions ?? []);
      setRevisionsState("ready");
    } catch (error) {
      setRevisionsState("error");
      setNotice(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    if (!isHistoryOpen) return;
    // Opening the panel starts an external request; its completion updates the panel state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRevisions();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsHistoryOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isHistoryOpen, loadRevisions]);

  const requestDraftSave = useCallback(async (snapshot: ScheduleConfig, expectedVersion: number) => {
    const response = await fetch("/api/schedule/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: snapshot, expectedDraftVersion: expectedVersion }),
    });
    const data = await response.json() as {
      draftVersion?: number;
      draftUpdatedAt?: string;
      updatedAt?: string;
      issues?: Array<{ path: string; message: string }>;
      error?: string;
      current?: ScheduleDocumentView;
    };
    if (response.status === 409 && data.current) throw new DraftConflictError(data.error ?? "草稿已被更新", data.current);
    if (!response.ok) throw new Error(data.issues?.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join("；") || data.error || "保存失败");
    return data as { draftVersion: number; draftUpdatedAt: string; updatedAt: string };
  }, []);

  const requestAdjustmentSave = useCallback(async (
    snapshot: ScheduleConfig,
    weekStart: string,
    weekIndex: number,
    sourceDraftVersion: number,
    expectedAdjustmentVersion: number,
  ) => {
    const response = await fetch("/api/schedule/adjustment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: snapshot,
        weekStart,
        weekIndex,
        sourceDraftVersion,
        expectedAdjustmentVersion,
      }),
    });
    const data = await response.json() as {
      temporaryAdjustment?: ScheduleAdjustmentView | null;
      temporaryAdjustmentVersion?: number;
      temporaryAdjustmentUpdatedAt?: string | null;
      currentWeek?: ScheduleWeekWindow;
      issues?: Array<{ path: string; message: string }>;
      error?: string;
      current?: ScheduleDocumentView;
    };
    if (response.status === 409 && data.current) {
      throw new DraftConflictError(data.error ?? "临时调课已被更新", data.current);
    }
    if (!response.ok || typeof data.temporaryAdjustmentVersion !== "number") {
      throw new Error(data.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("；") || data.error || "保存调课失败");
    }
    return data as {
      temporaryAdjustment: ScheduleAdjustmentView | null;
      temporaryAdjustmentVersion: number;
      temporaryAdjustmentUpdatedAt: string | null;
      currentWeek: ScheduleWeekWindow;
    };
  }, []);

  const cancelScheduledSave = useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (isAdjustmentMode || !config || !dirty) return;
    cancelScheduledSave();
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      const snapshot = config;
      try {
        setSaveState("saving");
        const result = await requestDraftSave(snapshot, draftVersion);
        setDraftVersion(result.draftVersion);
        setDraftUpdatedAt(result.draftUpdatedAt);
        if (JSON.stringify(lastConfigRef.current) === JSON.stringify(snapshot)) {
          setDirty(false);
          setSaveState("saved");
        }
      } catch (error) {
        setSaveState("error");
        if (error instanceof DraftConflictError) {
          setConflictCurrent(error.current);
          setNotice("草稿已在其他页面更新，请选择如何处理当前编辑");
          return;
        }
        setNotice(errorMessage(error));
      }
    }, 700);
    return () => {
      cancelScheduledSave();
    };
  }, [cancelScheduledSave, config, dirty, draftVersion, isAdjustmentMode, requestDraftSave]);

  const flushDraft = useCallback(async () => {
    if (!config || !dirty) return draftVersion;
    cancelScheduledSave();
    setSaveState("saving");
    const result = await requestDraftSave(config, draftVersion);
    setDraftVersion(result.draftVersion);
    setDraftUpdatedAt(result.draftUpdatedAt);
    setDirty(false);
    setSaveState("saved");
    return result.draftVersion;
  }, [cancelScheduledSave, config, dirty, draftVersion, requestDraftSave]);

  const announce = useCallback((message: string) => setNotice(message), []);
  const dismissNotice = useCallback(() => setNotice(""), []);

  async function enterAdjustmentMode() {
    if (isAdjustmentMode || !config || !publishedConfig || isSavingAdjustment || isEnteringAdjustmentMode) return;
    setIsEnteringAdjustmentMode(true);
    setIsExportMenuOpen(false);
    try {
      const sourceDraftVersion = await flushDraft();
      const savedAdjustment = temporaryAdjustment;
      const baseConfig = savedAdjustment ? cloneConfig(savedAdjustment.config) : cloneConfig(config);
      const baseWeekIndex = savedAdjustment?.weekIndex ?? weekIndex;
      setAdjustmentConfig(baseConfig);
      setAdjustmentWeekIndex(baseWeekIndex);
      setAdjustmentSourceDraftVersion(savedAdjustment?.sourceDraftVersion ?? sourceDraftVersion);
      setAdjustmentDirty(false);
      adjustmentUndoConfigRef.current = null;
      setSelectedCell(null);
      setActivePanel("schedule");
      setSidebarCollapsed(false);
      setIsAdjustmentMode(true);
      announce(savedAdjustment ? "已加载本周临时调课，可继续调整" : "已进入调课模式，当前草稿作为本周基线");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("草稿已在其他页面更新，请选择如何处理当前编辑");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsEnteringAdjustmentMode(false);
    }
  }

  function cancelAdjustmentMode() {
    if (isSavingAdjustment) return;
    setIsAdjustmentMode(false);
    setAdjustmentConfig(null);
    setAdjustmentWeekIndex(null);
    setAdjustmentDirty(false);
    adjustmentUndoConfigRef.current = null;
    setSelectedCell(null);
    setActivePanel("schedule");
    announce("已放弃本次调课修改");
  }

  async function saveAdjustmentMode() {
    if (!isAdjustmentMode || !adjustmentConfig || adjustmentWeekIndex === null || isSavingAdjustment) return;
    setIsSavingAdjustment(true);
    try {
      const result = await requestAdjustmentSave(
        adjustmentConfig,
        currentWeek.start,
        adjustmentWeekIndex,
        adjustmentSourceDraftVersion,
        temporaryAdjustmentVersion,
      );
      setTemporaryAdjustment(result.temporaryAdjustment);
      setTemporaryAdjustmentVersion(result.temporaryAdjustmentVersion);
      setCurrentWeek(result.currentWeek);
      setIsAdjustmentMode(false);
      setAdjustmentConfig(null);
      setAdjustmentWeekIndex(null);
      setAdjustmentDirty(false);
      adjustmentUndoConfigRef.current = null;
      setSelectedCell(null);
      setActivePanel("schedule");
      announce("已保存本周调课草稿，请点击发布草稿后生效");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("临时调课或草稿已在其他页面更新，请重新加载后再保存");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsSavingAdjustment(false);
    }
  }

  async function clearAdjustment() {
    if (!temporaryAdjustment || isClearingAdjustment || isSavingAdjustment) return;
    const hadActiveAdjustment = temporaryAdjustment.status === "active";
    const confirmMessage = hadActiveAdjustment
      ? "清除本周调课后，课表会恢复原课表。确定继续吗？"
      : "清除本周调课草稿后，待发布的调课内容会消失。确定继续吗？";
    if (!window.confirm(confirmMessage)) return;
    setIsClearingAdjustment(true);
    try {
      const response = await fetch("/api/schedule/adjustment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAdjustmentVersion: temporaryAdjustmentVersion }),
      });
      const data = await response.json() as {
        temporaryAdjustment?: ScheduleAdjustmentView | null;
        temporaryAdjustmentVersion?: number;
        temporaryAdjustmentUpdatedAt?: string | null;
        currentWeek?: ScheduleWeekWindow;
        error?: string;
        current?: ScheduleDocumentView;
      };
      if (response.status === 409 && data.current) throw new DraftConflictError(data.error ?? "临时调课已被更新", data.current);
      if (!response.ok || typeof data.temporaryAdjustmentVersion !== "number" || !data.currentWeek) {
        throw new Error(data.error ?? "清除调课失败");
      }
      setTemporaryAdjustment(data.temporaryAdjustment ?? null);
      setTemporaryAdjustmentVersion(data.temporaryAdjustmentVersion);
      setCurrentWeek(data.currentWeek);
      const baseConfig = config ? cloneConfig(config) : null;
      setAdjustmentConfig(baseConfig);
      setAdjustmentWeekIndex(weekIndex);
      setAdjustmentSourceDraftVersion(draftVersion);
      setAdjustmentDirty(false);
      adjustmentUndoConfigRef.current = null;
      announce(hadActiveAdjustment ? "已清除本周调课，课表已恢复原课表" : "已清除本周调课草稿");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("临时调课已在其他页面更新，请重新加载后再操作");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsClearingAdjustment(false);
    }
  }

  const diffItems = useMemo(
    () => (config && publishedConfig ? diffScheduleConfigs(config, publishedConfig) : []),
    [config, publishedConfig],
  );

  const adjustmentCells = useMemo(() => {
    const details = new Map<string, AdjustmentCellDisplay>();
    if (isAdjustmentMode || !config || !temporaryAdjustment) return details;
    temporaryAdjustment.changedCells.forEach(({ dayIndex, classIndex }) => {
      const baseDay = config.daily_class[dayIndex];
      const adjustmentDay = temporaryAdjustment.config.daily_class[dayIndex];
      const baseValue = baseDay?.classList[classIndex];
      const adjustmentValue = adjustmentDay?.classList[classIndex];
      const originalCode = getCourseForWeek(baseValue, temporaryAdjustment.weekIndex);
      const temporaryCode = getCourseForWeek(adjustmentValue, temporaryAdjustment.weekIndex);
      const originalName = config.subject_name[originalCode] ?? PLACEHOLDER_SUBJECT_NAME;
      const temporaryName = temporaryAdjustment.config.subject_name[temporaryCode] ?? PLACEHOLDER_SUBJECT_NAME;
      details.set(
        `${dayIndex}:${classIndex}`,
        {
          note: `本周暂调：${temporaryName}（${temporaryCode}），原课：${originalName}（${originalCode}）`,
          targetName: temporaryName,
        },
      );
    });
    return details;
  }, [config, isAdjustmentMode, temporaryAdjustment]);

  async function handleCreateRevision() {
    if (isAdjustmentMode || !config || isCreatingRevision) return;
    setIsCreatingRevision(true);
    try {
      const version = await flushDraft();
      const response = await fetch("/api/schedule/revisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDraftVersion: version, note: revisionNote }),
      });
      const data = await response.json() as {
        revision?: ScheduleRevisionView;
        error?: string;
        current?: ScheduleDocumentView;
      };
      if (response.status === 409 && data.current) throw new DraftConflictError(data.error ?? "草稿已被更新", data.current);
      if (!response.ok || !data.revision) throw new Error(data.error ?? "创建版本快照失败");
      setRevisions((current) => [data.revision as ScheduleRevisionView, ...current]);
      setRevisionNote("");
      announce("已创建草稿快照");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("草稿已在其他页面更新，请选择如何处理当前编辑");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsCreatingRevision(false);
    }
  }

  async function handleRestoreRevision(revisionId: number) {
    if (isAdjustmentMode || restoringRevisionId !== null) return;
    const confirmed = window.confirm("恢复此快照会覆盖当前草稿，但不会自动发布。确定继续吗？");
    if (!confirmed) return;
    setRestoringRevisionId(revisionId);
    cancelScheduledSave();
    try {
      const response = await fetch("/api/schedule/revisions/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId, expectedDraftVersion: draftVersion }),
      });
      const data = await response.json() as {
        current?: ScheduleDocumentView;
        issues?: Array<{ path: string; message: string }>;
        error?: string;
      };
      if (response.status === 409 && data.current) throw new DraftConflictError(data.error ?? "草稿已被更新", data.current);
      if (!response.ok || !data.current) throw new Error(data.issues?.map((issue) => `${issue.path}: ${issue.message}`).join("；") || data.error || "恢复版本失败");
      applyScheduleView(data.current);
      setImportWarnings([]);
      setSelectedCell(null);
      await loadRevisions();
      announce(`已恢复快照，当前草稿为 v${data.current.draftVersion}`);
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("草稿已在其他页面更新，请选择如何处理当前编辑");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setRestoringRevisionId(null);
    }
  }

  function reloadConflict() {
    if (!conflictCurrent) return;
    applyScheduleView(conflictCurrent);
    setImportWarnings([]);
    setSelectedCell(null);
    setConflictCurrent(null);
    announce("已加载服务器草稿");
  }

  async function overwriteConflict() {
    if (!conflictCurrent || !config || isResolvingConflict) return;
    setIsResolvingConflict(true);
    cancelScheduledSave();
    try {
      setSaveState("saving");
      const result = await requestDraftSave(config, conflictCurrent.draftVersion);
      setDraftVersion(result.draftVersion);
      setDraftUpdatedAt(result.draftUpdatedAt);
      setDirty(false);
      setConflictCurrent(null);
      setSaveState("saved");
      announce("已用当前页面内容覆盖服务器草稿");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("服务器草稿又发生了变化，请重新选择处理方式");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsResolvingConflict(false);
    }
  }

  const commit = useCallback((updater: ConfigUpdater, message?: string) => {
    if (isAdjustmentMode) {
      setAdjustmentConfig((current) => {
        if (!current) return current;
        const next = updater(current);
        const validation = validateScheduleConfig(next);
        if (!validation.success) {
          setNotice(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
          return current;
        }
        if (next !== current) {
          adjustmentUndoConfigRef.current = current;
          setAdjustmentDirty(true);
        }
        return next;
      });
      if (message) setNotice(message);
      return;
    }
    setConfig((current) => {
      if (!current) return current;
      const next = updater(current);
      const validation = validateScheduleConfig(next);
      if (!validation.success) {
        setSaveState("error");
        setNotice(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；"));
        return current;
      }
      if (next !== current) {
        undoConfigRef.current = current;
        setDirty(true);
        setSaveState("idle");
      }
      return next;
    });
    if (message) setSaveState("idle");
  }, [isAdjustmentMode]);

  function undoLastChange() {
    if (isAdjustmentMode) {
      if (!adjustmentUndoConfigRef.current) return announce("当前没有可撤销的操作");
      const previous = adjustmentUndoConfigRef.current;
      adjustmentUndoConfigRef.current = null;
      setAdjustmentConfig(previous);
      setAdjustmentDirty(true);
      announce("已撤销上一步调课操作");
      return;
    }
    if (!undoConfigRef.current) return announce("当前没有可撤销的操作");
    const previous = undoConfigRef.current;
    undoConfigRef.current = null;
    setConfig(previous);
    setDirty(true);
    setSaveState("idle");
    announce("已撤销上一步操作");
  }

  function parseCellId(id: string) {
    const parts = id.split(":");
    if (parts.length !== 4 || parts[0] !== "cell" || (parts[1] !== "desktop" && parts[1] !== "mobile")) return null;
    const dayIndex = Number(parts[2]);
    const classIndex = Number(parts[3]);
    if (!Number.isInteger(dayIndex) || !Number.isInteger(classIndex) || dayIndex < 0 || classIndex < 0) return null;
    return { dayIndex, classIndex };
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    const activeConfig = isAdjustmentMode ? adjustmentConfig : config;
    const activeWeekIndex = isAdjustmentMode ? adjustmentWeekIndex : weekIndex;
    if (!activeConfig || activeWeekIndex === null || !overId.startsWith("cell:")) return;
    const target = parseCellId(overId);
    if (!target) return;
    if (activeId.startsWith("subject:")) {
      if (isAdjustmentMode) return;
      const code = activeId.slice("subject:".length);
      commit((current) => setDayCourse(current, target.dayIndex, target.classIndex, activeWeekIndex, code), "已将课程放入单元格");
      setSelectedCell(target);
      return;
    }
    const source = parseCellId(activeId);
    if (!source || (source.dayIndex === target.dayIndex && source.classIndex === target.classIndex)) return;
    commit(
      (current) => isAdjustmentMode
        ? swapAdjustmentCourses(current, source.dayIndex, source.classIndex, target.dayIndex, target.classIndex, activeWeekIndex)
        : swapDayCourses(current, source.dayIndex, source.classIndex, target.dayIndex, target.classIndex, activeWeekIndex),
      isAdjustmentMode ? "已交换本周临时课程" : "已交换课程",
    );
    setSelectedCell(target);
  }

  function downloadConfig(which: "draft" | "published") {
    if (isAdjustmentMode) return;
    const target = which === "draft" ? config : publishedConfig;
    if (!target) return;
    setIsExporting(true);
    const blob = new Blob([JSON.stringify(target, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `class-schedule-${which}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setIsExporting(false);
    announce(`已导出${which === "draft" ? "草稿" : "已发布配置"}`);
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    if (isAdjustmentMode) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const result = normalizeScheduleConfig(raw);
      setConfig(result.config);
      setImportWarnings(result.warnings);
      setDirty(true);
      setSaveState("idle");
      if (result.warnings.length) setNotice(`已导入，发现 ${result.warnings.length} 条兼容性提示`);
    } catch (error) {
      setImportWarnings([]);
      setNotice(errorMessage(error));
    }
  }

  async function handlePublish() {
    if (isAdjustmentMode || !config || isPublishing) return;
    setIsPublishing(true);
    try {
      const version = await flushDraft();
      const response = await fetch("/api/schedule/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDraftVersion: version }),
      });
      const data = await response.json() as {
        publishedVersion?: number;
        publishedAt?: string | null;
        issues?: Array<{ path: string; message: string }>;
        error?: string;
        current?: ScheduleDocumentView;
      };
      if (response.status === 409 && data.current) throw new DraftConflictError(data.error ?? "草稿已被更新", data.current);
      if (!response.ok) throw new Error(data.issues?.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join("；") || data.error || "发布失败");
      setPreviousPublishedConfig(publishedConfig);
      setPublishedConfig(config);
      setPublishedVersion(data.publishedVersion ?? publishedVersion);
      setPublishedAt(data.publishedAt ?? null);
      if (data.current) {
        setTemporaryAdjustment(data.current.temporaryAdjustment);
        setTemporaryAdjustmentVersion(data.current.temporaryAdjustmentVersion);
        setCurrentWeek(data.current.currentWeek);
      }
      setSaveState("saved");
      void loadRevisions();
      announce(data.current?.temporaryAdjustment?.status === "active" ? "已发布草稿，本周调课已生效" : "已发布当前草稿");
    } catch (error) {
      setSaveState("error");
      if (error instanceof DraftConflictError) {
        setConflictCurrent(error.current);
        setNotice("草稿已在其他页面更新，请选择如何处理当前编辑");
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setIsPublishing(false);
    }
  }

  function resetToBlank() {
    const blank = createBlankConfig();
    setConfig(blank);
    setDirty(true);
    setSaveState("idle");
    setImportWarnings([]);
    setActiveTemplate("workday");
    setSelectedCell(null);
  }

  const templateNames = useMemo(() => (config ? Object.keys(config.timetable) : []), [config]);
  const activeConfig = isAdjustmentMode ? adjustmentConfig : config;
  const activeWeekIndex = isAdjustmentMode ? adjustmentWeekIndex : weekIndex;

  if (loadState === "loading") {
    return <main className="editor-loading"><div className="loading-skeleton" /><div className="loading-skeleton loading-skeleton-large" /><p>正在读取课表草稿…</p></main>;
  }

  if (loadState === "error" || !config || !activeConfig || activeWeekIndex === null) {
    return (
      <main className="editor-error-state">
        <AlertTriangle size={28} />
        <h1>课表暂时无法打开</h1>
        <p>{loadError || "请检查数据库连接和编辑器配置。"}</p>
        <button className="primary-button" type="button" onClick={() => void loadSchedule()}><RefreshCw size={16} />重新连接</button>
      </main>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerPreferredCollisionDetection} onDragEnd={handleDragEnd}>
      <main className={`editor-shell${resizeSide ? " is-resizing" : ""}${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${isAdjustmentMode ? " is-adjustment-mode" : ""}`} data-mobile-panel={activePanel} data-sidebar-panel={activePanel} data-adjustment-mode={isAdjustmentMode ? "true" : "false"}>
        <span className="adjustment-mode-reveal" aria-hidden="true" />
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark"><CalendarClock size={17} /></div>
            <div>
              <span className="brand-name">课表编排器</span>
              <span className="brand-subtitle">Electron compatible</span>
            </div>
          </div>
          <div className="topbar-status">
            {isAdjustmentMode ? <AdjustmentModeStatus dirty={adjustmentDirty} weekIndex={activeWeekIndex} /> : <>
              <DraftStatusControl saveState={saveState} dirty={dirty} draftVersion={draftVersion} draftUpdatedAt={draftUpdatedAt} unpublishedChanges={diffItems.length} />
              {temporaryAdjustment ? <TemporaryAdjustmentStatus status={temporaryAdjustment.status} /> : null}
            </>}
            {!isAdjustmentMode ? <>
              <VersionMarker icon={<Send size={14} />} value={publishedVersion} label={`已发布 v${publishedVersion}`} />
              {publishedAt ? <VersionMarker icon={<Clock3 size={15} />} label={`更新于 ${new Date(publishedAt).toLocaleString("zh-CN", { hour12: false })}`} /> : null}
            </> : <span className="adjustment-validity-chip">{formatScheduleDate(currentWeek.start)} - {formatScheduleDate(currentWeek.end)}</span>}
            <EditorPresence user={user} />
          </div>
          <div className="topbar-actions">
            <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={handleImport} />
            <button
              className={`icon-button toolbar-icon-button adjustment-trigger${temporaryAdjustment ? " has-active-adjustment" : ""}${isAdjustmentMode ? " is-adjustment-active" : ""}${isEnteringAdjustmentMode ? " is-busy" : ""}`}
              type="button"
              aria-label={isAdjustmentMode ? "放弃调课" : "调课模式"}
              data-tooltip={isAdjustmentMode ? "放弃调课" : temporaryAdjustment ? "编辑本周调课" : "调课模式"}
              title={isAdjustmentMode ? "放弃调课" : temporaryAdjustment ? "编辑本周调课" : "调课模式"}
              onClick={() => { if (isAdjustmentMode) cancelAdjustmentMode(); else void enterAdjustmentMode(); }}
              disabled={isEnteringAdjustmentMode || isSavingAdjustment || isClearingAdjustment}
            >
              <span className={`toolbar-icon-state toolbar-icon-state-mode${isAdjustmentMode ? "" : " is-visible"}`} aria-hidden="true">
                {isEnteringAdjustmentMode ? <RefreshCw className="toolbar-spinner" size={16} /> : <CalendarClock size={16} />}
              </span>
              <span className={`toolbar-icon-state toolbar-icon-state-exit${isAdjustmentMode ? " is-visible" : ""}`} aria-hidden="true"><X size={16} /></span>
            </button>
            {temporaryAdjustment ? <button className={`icon-button toolbar-icon-button adjustment-clear-trigger${isAdjustmentMode ? " toolbar-action-disabled" : ""}`} type="button" aria-label={temporaryAdjustment.status === "active" ? "撤销本周调课" : "取消调课草稿"} data-tooltip={isAdjustmentMode ? "调课模式中不可用" : temporaryAdjustment.status === "active" ? "撤销本周调课" : "取消调课草稿"} title={isAdjustmentMode ? "调课模式中不可用" : temporaryAdjustment.status === "active" ? "撤销本周调课" : "取消调课草稿"} onClick={() => void clearAdjustment()} disabled={isAdjustmentMode || isClearingAdjustment || isSavingAdjustment}><RotateCcw size={16} /></button> : null}
            <button className={`icon-button toolbar-icon-button${isAdjustmentMode ? " toolbar-action-disabled" : ""}`} type="button" aria-label="版本历史" aria-expanded={isHistoryOpen} data-tooltip={isAdjustmentMode ? "调课模式中不可用" : "版本历史"} title={isAdjustmentMode ? "调课模式中不可用" : "版本历史"} onClick={() => { setHistoryTab("history"); setIsHistoryOpen(true); }} disabled={isAdjustmentMode}><History size={16} /></button>
            <button className={`icon-button toolbar-icon-button${isAdjustmentMode ? " toolbar-action-disabled" : ""}`} type="button" aria-label="导入配置" data-tooltip={isAdjustmentMode ? "调课模式中不可用" : "导入配置"} title={isAdjustmentMode ? "调课模式中不可用" : "导入配置"} onClick={() => fileInputRef.current?.click()} disabled={isAdjustmentMode}><Upload size={16} /></button>
            <div ref={exportMenuRef} className={`export-menu${isExportMenuOpen ? " is-open" : ""}${isAdjustmentMode ? " is-adjustment-disabled" : ""}`}>
              <button className={`icon-button toolbar-icon-button${isAdjustmentMode ? " toolbar-action-disabled" : ""}`} type="button" aria-label="导出配置" aria-expanded={isExportMenuOpen} aria-controls="export-menu-popover" data-tooltip={isAdjustmentMode ? "调课模式中不可用" : "导出配置"} title={isAdjustmentMode ? "调课模式中不可用" : "导出配置"} onClick={() => setIsExportMenuOpen((current) => !current)} disabled={isExporting || isAdjustmentMode}>
                <span className="toolbar-export-glyph" aria-hidden="true"><Download size={16} /></span>
                <ChevronDown className="toolbar-chevron" size={8} strokeWidth={2.5} aria-hidden="true" />
              </button>
              <div id="export-menu-popover" className="export-menu-popover" role="menu" aria-label="导出选项">
                <button type="button" role="menuitem" onClick={() => { setIsExportMenuOpen(false); downloadConfig("draft"); }}><Download size={14} />导出草稿 JSON</button>
                <button type="button" role="menuitem" onClick={() => { setIsExportMenuOpen(false); downloadConfig("published"); }}><Download size={14} />导出已发布 JSON</button>
              </div>
            </div>
            <button
              className={`primary-button toolbar-icon-button toolbar-publish-button${isAdjustmentMode ? " is-adjustment-confirm" : ""}`}
              type="button"
              aria-label={isAdjustmentMode ? (isSavingAdjustment ? "保存调课中" : "保存调课") : (isPublishing ? "发布中" : "发布草稿")}
              data-tooltip={isAdjustmentMode ? (isSavingAdjustment ? "保存调课中" : "保存调课") : (isPublishing ? "发布中" : "发布草稿")}
              title={isAdjustmentMode ? (isSavingAdjustment ? "保存调课中" : "保存调课") : (isPublishing ? "发布中" : "发布草稿")}
              onClick={() => void (isAdjustmentMode ? saveAdjustmentMode() : handlePublish())}
              disabled={isAdjustmentMode ? isSavingAdjustment || isClearingAdjustment : isPublishing || saveState === "saving"}
            >
              <span className={`toolbar-icon-state toolbar-icon-state-publish${isAdjustmentMode ? "" : " is-visible"}`} aria-hidden="true">
                {isPublishing ? <RefreshCw className="toolbar-spinner" size={16} /> : <Send size={16} />}
              </span>
              <span className={`toolbar-icon-state toolbar-icon-state-confirm${isAdjustmentMode ? " is-visible" : ""}`} aria-hidden="true">
                {isSavingAdjustment ? <RefreshCw className="toolbar-spinner" size={16} /> : <Check size={17} />}
              </span>
            </button>
          </div>
        </header>

        <nav className="mobile-nav" aria-label="编辑器面板">
          {isAdjustmentMode ? (
            <>
              <button className={activePanel === "schedule" ? "is-active" : ""} type="button" onClick={() => setActivePanel("schedule")}><LayoutGrid size={16} />课表</button>
              <button className={activePanel === "inspector" ? "is-active" : ""} type="button" onClick={() => setActivePanel("inspector")}><Settings2 size={16} />检查</button>
              <button className={activePanel === "validity" ? "is-active" : ""} type="button" onClick={() => setActivePanel("validity")}><Clock3 size={16} />时效</button>
            </>
          ) : (
            <>
              <button className={activePanel === "schedule" ? "is-active" : ""} type="button" onClick={() => setActivePanel("schedule")}><LayoutGrid size={16} />课表</button>
              <button className={activePanel === "templates" ? "is-active" : ""} type="button" onClick={() => setActivePanel("templates")}><CalendarClock size={16} />模板</button>
              <button className={activePanel === "subjects" ? "is-active" : ""} type="button" onClick={() => setActivePanel("subjects")}><BookOpen size={16} />课程</button>
              <button className={activePanel === "inspector" ? "is-active" : ""} type="button" onClick={() => setActivePanel("inspector")}><Settings2 size={16} />检查</button>
              <button className={activePanel === "style" ? "is-active" : ""} type="button" onClick={() => setActivePanel("style")}><Palette size={16} />样式</button>
              <button className={activePanel === "preview" ? "is-active" : ""} type="button" onClick={() => setActivePanel("preview")}><Eye size={16} />预览</button>
            </>
          )}
        </nav>

        <div className="editor-body">
          <ActivityRail adjustmentMode={isAdjustmentMode} activePanel={activePanel} onSelect={setActivePanel} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((current) => !current)} />
          <div
            className="workbench-grid"
            style={{ "--left-rail-width": `${leftRailWidth}px` } as React.CSSProperties}
          >
            <aside className="left-rail">
              <SidebarHeader onCollapse={() => setSidebarCollapsed(true)} />
              <div className="sidebar-content" key={activePanel}>
                {activePanel === "schedule" ? (
                  <SidebarOverview config={activeConfig} activeTemplate={activeTemplate} selectedDay={selectedDay} weekIndex={activeWeekIndex} selectedCell={selectedCell} adjustmentMode={isAdjustmentMode} temporaryAdjustment={temporaryAdjustment} onClearAdjustment={() => void clearAdjustment()} clearingAdjustment={isClearingAdjustment} onSelect={setActivePanel} />
                ) : null}
                {activePanel === "templates" && !isAdjustmentMode ? (
                  <TemplatePanel key={activeTemplate} config={activeConfig} activeTemplate={activeTemplate} setActiveTemplate={setActiveTemplate} commit={commit} announce={announce} />
                ) : null}
                {activePanel === "subjects" && !isAdjustmentMode ? <SubjectLibrary config={activeConfig} commit={commit} announce={announce} /> : null}
                {activePanel === "inspector" ? <InspectorPanel config={activeConfig} selectedCell={selectedCell} weekIndex={activeWeekIndex} adjustmentMode={isAdjustmentMode} setWeekIndex={setWeekIndex} commit={commit} announce={announce} /> : null}
                {activePanel === "style" && !isAdjustmentMode ? <StylePanel config={activeConfig} commit={commit} announce={announce} /> : null}
                {activePanel === "preview" && !isAdjustmentMode ? <PreviewPanel config={activeConfig} dayIndex={selectedDay} weekIndex={activeWeekIndex} /> : null}
                {activePanel === "validity" && isAdjustmentMode ? <AdjustmentValidityPanel currentWeek={currentWeek} adjustment={temporaryAdjustment} weekIndex={activeWeekIndex} onClear={() => void clearAdjustment()} clearing={isClearingAdjustment} /> : null}
              </div>
              {!isAdjustmentMode ? <button className="reset-link sidebar-reset" type="button" onClick={resetToBlank}><Import size={14} />使用空白模板</button> : null}
            </aside>

            <ResizeHandle side="left" width={leftRailWidth} onStart={startRailResize} onKeyboardResize={adjustRailWidth} />

            <div className="center-stage">
              <ScheduleMatrix config={activeConfig} activeTemplate={activeTemplate} adjustmentMode={isAdjustmentMode} adjustmentCells={adjustmentCells} selectedDay={selectedDay} setSelectedDay={setSelectedDay} setActiveTemplate={setActiveTemplate} selectedCell={selectedCell} onSelect={(dayIndex, classIndex) => { setSelectedCell({ dayIndex, classIndex }); setActivePanel("inspector"); }} commit={commit} announce={announce} weekIndex={activeWeekIndex} />
              {importWarnings.length && !isAdjustmentMode ? (
                <section className="warning-panel">
                  <div className="warning-heading"><AlertTriangle size={16} /><strong>导入兼容提示</strong><button className="icon-button" type="button" aria-label="关闭导入提示" title="关闭导入提示" onClick={() => setImportWarnings([])}><X size={15} /></button></div>
                  <ul>{importWarnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </section>
              ) : null}
              <div className="stage-bottom-bar">
                <span><span className="legend-dot legend-accent" />{isAdjustmentMode ? "本周临时课表" : "草稿编辑区"}</span>
                {!isAdjustmentMode && temporaryAdjustment ? <span><span className="legend-dot legend-adjustment" />暂调课程</span> : null}
                <span><span className="legend-dot legend-muted" />事件不会占用课程索引</span>
                <button className="undo-button" type="button" onClick={undoLastChange}><Undo2 size={14} />撤销</button>
              </div>
            </div>
          </div>
        </div>

        {notice ? <Notice message={notice} onDismiss={dismissNotice} /> : null}
        {isHistoryOpen ? (
          <VersionHistoryModal
            activeTab={historyTab}
            draftVersion={draftVersion}
            publishedVersion={publishedVersion}
            draftUpdatedAt={draftUpdatedAt}
            diffItems={diffItems}
            revisions={revisions}
            revisionsState={revisionsState}
            revisionNote={revisionNote}
            creatingRevision={isCreatingRevision}
            restoringRevisionId={restoringRevisionId}
            onTabChange={setHistoryTab}
            onNoteChange={setRevisionNote}
            onCreateRevision={() => void handleCreateRevision()}
            onRestoreRevision={(revisionId) => void handleRestoreRevision(revisionId)}
            onClose={() => setIsHistoryOpen(false)}
          />
        ) : null}
        {conflictCurrent ? (
          <ConflictDialog
            current={conflictCurrent}
            localConfig={config}
            resolving={isResolvingConflict}
            onReload={reloadConflict}
            onOverwrite={() => void overwriteConflict()}
            onClose={() => setConflictCurrent(null)}
          />
        ) : null}
        <div className="sr-only" aria-live="polite">草稿版本 {draftVersion}，{dirty ? "有未保存改动" : "已保存"}</div>
      </main>
    </DndContext>
  );
}
