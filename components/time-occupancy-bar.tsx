"use client";

import { useRef, useState } from "react";

import {
  buildOccupancyHint,
  clampMove,
  clampResize,
  computeOccupancyViewport,
  findOverlap,
  formatMinutesOfDay,
  gapContaining,
  getOccupiedRanges,
  inclusiveDurationMinutes,
  nearestGap,
  nudgeRange,
  placeRangeAt,
  rangeBetween,
  type MinuteGap,
  type OccupancyViewport,
} from "@/lib/schedule/time-occupancy";
import type { TemplateRow } from "@/lib/schedule/types";
import { parseTimeRange } from "@/lib/schedule/validation";

function percentInViewport(minutes: number, viewportStart: number, viewportSpan: number): number {
  if (viewportSpan <= 0) return 0;
  return ((minutes - viewportStart) / viewportSpan) * 100;
}

function formatClock(start: number, end: number) {
  return `${formatMinutesOfDay(start)}–${formatMinutesOfDay(end)}`;
}

function toTimeRange(start: number, end: number) {
  return `${formatMinutesOfDay(start)}-${formatMinutesOfDay(end)}`;
}

function minutesFromClientX(clientX: number, rect: DOMRect, viewport: OccupancyViewport) {
  if (rect.width <= 0) return viewport.start;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(viewport.start + ratio * (viewport.end - viewport.start));
}

type DragMode = "move" | "start" | "end" | "create";

type DragState = {
  mode: DragMode;
  originX: number;
  originMinute: number;
  originStart: number;
  originEnd: number;
  gap: MinuteGap;
  viewport: OccupancyViewport;
  moved: boolean;
};

export function TimeOccupancyBar({
  rows,
  draftTimeRange,
  exceptTimeRange,
  hintId,
  onSelectRange,
  onPreviewRange,
}: {
  rows: TemplateRow[];
  draftTimeRange: string;
  exceptTimeRange?: string;
  hintId?: string;
  onSelectRange?: (timeRange: string) => void;
  onPreviewRange?: (timeRange: string) => void;
}) {
  const occupied = getOccupiedRanges(rows, exceptTimeRange);
  const draft = parseTimeRange(draftTimeRange);
  const validDraft = draft && draft.start < draft.end ? draft : null;
  const overlap = validDraft ? findOverlap(occupied, validDraft) : null;
  const viewport = computeOccupancyViewport(occupied, validDraft);
  const span = Math.max(1, viewport.end - viewport.start);
  const hint = buildOccupancyHint({ draft: validDraft, overlap, occupied });
  const isOverlap = Boolean(overlap) || !validDraft;
  const duration = validDraft ? inclusiveDurationMinutes(validDraft.start, validDraft.end) : 40;
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const interactive = Boolean(onSelectRange);

  function emitPreview(next: { start: number; end: number } | null) {
    if (!next || next.end <= next.start) return;
    (onPreviewRange ?? onSelectRange)?.(toTimeRange(next.start, next.end));
  }

  function rangeForDrag(drag: DragState, minute: number) {
    if (drag.mode === "move") return clampMove(drag.gap, drag.originStart, drag.originEnd, minute - drag.originMinute);
    if (drag.mode === "start" || drag.mode === "end") return clampResize(drag.gap, drag.originStart, drag.originEnd, drag.mode, minute);
    if (!drag.moved) return placeRangeAt(occupied, drag.originMinute, duration);
    return rangeBetween(occupied, drag.originMinute, minute);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || event.button !== 0) return;
    const track = event.currentTarget;
    const minute = minutesFromClientX(event.clientX, track.getBoundingClientRect(), viewport);
    const handle = (event.target as HTMLElement).closest("[data-handle]")?.getAttribute("data-handle");
    let mode: DragMode = "create";
    if (handle === "move" || handle === "start" || handle === "end") mode = handle;
    else if (occupied.some((item) => minute >= item.start && minute <= item.end)) return;

    const originStart = validDraft?.start ?? minute;
    const originEnd = validDraft?.end ?? Math.min(viewport.end, minute + duration - 1);
    const midpoint = Math.round((originStart + originEnd) / 2);
    const gap = (mode === "create" ? gapContaining(occupied, minute) : gapContaining(occupied, midpoint)) ?? nearestGap(occupied, minute);
    dragRef.current = {
      mode,
      originX: event.clientX,
      originMinute: minute,
      originStart,
      originEnd,
      gap,
      viewport,
      moved: false,
    };
    setDragging(true);
    track.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(event.clientX - drag.originX) > 3) drag.moved = true;
    if (drag.mode === "create" && !drag.moved) return;
    const minute = minutesFromClientX(event.clientX, event.currentTarget.getBoundingClientRect(), drag.viewport);
    emitPreview(rangeForDrag(drag, minute));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const minute = minutesFromClientX(event.clientX, event.currentTarget.getBoundingClientRect(), drag.viewport);
    const next = rangeForDrag(drag, minute);
    if (!next || next.end <= next.start) return;
    const value = toTimeRange(next.start, next.end);
    onPreviewRange?.(value);
    onSelectRange?.(value);
    event.currentTarget.focus({ preventScroll: true });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!interactive || !validDraft) return;
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = nudgeRange(occupied, validDraft, event.shiftKey ? direction * 5 : direction);
    const value = toTimeRange(next.start, next.end);
    onPreviewRange?.(value);
    onSelectRange?.(value);
  }

  return (
    <div className={`occupancy-panel${isOverlap ? " is-overlap" : ""}`} data-testid="time-occupancy">
      <div className="occupancy-bar">
        <div
          className={`occupancy-bar-track${interactive ? " is-interactive" : ""}${dragging ? " is-dragging" : ""}`}
          data-testid="time-range-track"
          tabIndex={interactive ? 0 : undefined}
          role="group"
          aria-label={interactive ? "拖动蓝框调整时间，拖两端改时长" : "时间占用示意"}
          onPointerDown={interactive ? handlePointerDown : undefined}
          onPointerMove={interactive ? handlePointerMove : undefined}
          onPointerUp={interactive ? handlePointerUp : undefined}
          onPointerCancel={interactive ? handlePointerUp : undefined}
          onKeyDown={interactive ? handleKeyDown : undefined}
        >
          {occupied.map((item) => (
            <OccupiedBlock
              key={item.timeRange}
              item={item}
              viewportStart={viewport.start}
              span={span}
              conflict={overlap?.timeRange === item.timeRange}
            />
          ))}
          {validDraft ? (
            <div
              className={`occupancy-block occupancy-block-draft${overlap ? " is-conflict" : ""}`}
              data-handle="move"
              style={{
                left: `${percentInViewport(validDraft.start, viewport.start, span)}%`,
                width: `${Math.max(1.2, percentInViewport(validDraft.end + 1, viewport.start, span) - percentInViewport(validDraft.start, viewport.start, span))}%`,
              }}
              title={formatClock(validDraft.start, validDraft.end)}
            >
              {interactive ? <span className="occupancy-handle occupancy-handle-start" data-handle="start" /> : null}
              {interactive ? <span className="occupancy-handle occupancy-handle-end" data-handle="end" /> : null}
            </div>
          ) : null}
        </div>
        <div className="occupancy-bar-ticks" aria-hidden="true">
          <span>{formatMinutesOfDay(viewport.start)}</span>
          <span>{formatMinutesOfDay(Math.round((viewport.start + viewport.end) / 2))}</span>
          <span>{formatMinutesOfDay(viewport.end)}</span>
        </div>
      </div>
      <p
        id={hintId}
        className={`occupancy-hint${isOverlap ? " is-overlap" : ""}`}
        role={isOverlap ? "alert" : undefined}
      >
        {hint}
      </p>
    </div>
  );
}

function OccupiedBlock({
  item,
  viewportStart,
  span,
  conflict,
}: {
  item: ReturnType<typeof getOccupiedRanges>[number];
  viewportStart: number;
  span: number;
  conflict: boolean;
}) {
  const left = percentInViewport(item.start, viewportStart, span);
  const width = Math.max(1.2, percentInViewport(item.end + 1, viewportStart, span) - left);
  return (
    <span
      className={`occupancy-block occupancy-block-${item.kind}${conflict ? " is-conflict" : ""}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${item.label} ${formatClock(item.start, item.end)}`}
    >
      {width >= 14 ? <span className="occupancy-block-label">{item.label}</span> : null}
    </span>
  );
}
