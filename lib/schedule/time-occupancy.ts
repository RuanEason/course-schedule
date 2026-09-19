import type { TemplateRow } from "./types";
import { parseTimeRange } from "./validation";

export type OccupiedRange = {
  timeRange: string;
  start: number;
  end: number;
  kind: "class" | "event";
  label: string;
};

export type OccupancyViewport = {
  start: number;
  end: number;
};

export type NearestGaps = {
  beforeEnd: number | null;
  afterStart: number | null;
};

const DAY_START = 0;
const DAY_END = 23 * 60 + 59;
const DEFAULT_DURATION_MINUTES = 40;
const VIEWPORT_PADDING_MINUTES = 45;

export function formatMinutesOfDay(minutes: number): string {
  const clamped = Math.max(DAY_START, Math.min(DAY_END, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const remainder = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function formatOccupiedLabel(row: TemplateRow): string {
  if (row.kind === "event") {
    const label = row.eventLabel?.trim();
    return label || "事件";
  }
  return `第 ${(row.classIndex ?? 0) + 1} 节`;
}

export function getOccupiedRanges(rows: TemplateRow[], except?: string): OccupiedRange[] {
  return rows
    .filter((row) => row.timeRange !== except)
    .map((row) => {
      const parsed = parseTimeRange(row.timeRange);
      if (!parsed) return null;
      return {
        timeRange: row.timeRange,
        start: parsed.start,
        end: parsed.end,
        kind: row.kind,
        label: formatOccupiedLabel(row),
      } satisfies OccupiedRange;
    })
    .filter((range): range is OccupiedRange => range !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

export function findOverlap(
  occupied: OccupiedRange[],
  candidate: { start: number; end: number } | string,
): OccupiedRange | null {
  const range = typeof candidate === "string" ? parseTimeRange(candidate) : candidate;
  if (!range || range.start >= range.end) return null;
  return occupied.find((item) => rangesOverlap(range, item)) ?? null;
}

export function findNearestGaps(
  occupied: OccupiedRange[],
  candidate: { start: number; end: number },
): NearestGaps {
  let beforeEnd: number | null = null;
  let afterStart: number | null = null;

  for (const item of occupied) {
    if (item.end < candidate.start) {
      beforeEnd = item.end;
      continue;
    }
    if (item.start > candidate.end) {
      afterStart = item.start;
      break;
    }
  }

  return { beforeEnd, afterStart };
}

function snapDown(minutes: number, step = 15) {
  return Math.floor(minutes / step) * step;
}

function snapUp(minutes: number, step = 15) {
  return Math.ceil(minutes / step) * step;
}

export function computeOccupancyViewport(
  occupied: OccupiedRange[],
  draft?: { start: number; end: number } | null,
  paddingMinutes = VIEWPORT_PADDING_MINUTES,
): OccupancyViewport {
  const validDraft = draft && draft.start < draft.end ? draft : null;
  const points: number[] = [];

  if (validDraft) {
    points.push(validDraft.start, validDraft.end);
    let previous: OccupiedRange | null = null;
    let next: OccupiedRange | null = null;
    for (const item of occupied) {
      if (rangesOverlap(item, validDraft)) points.push(item.start, item.end);
      if (item.end < validDraft.start) previous = item;
      else if (item.start > validDraft.end && !next) next = item;
    }
    if (previous) points.push(previous.start, previous.end);
    if (next) points.push(next.start, next.end);
  } else {
    for (const item of occupied) points.push(item.start, item.end);
  }

  if (points.length === 0) {
    return { start: 8 * 60, end: 12 * 60 };
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  let start = Math.max(DAY_START, min - (validDraft ? 20 : paddingMinutes));
  let end = Math.min(DAY_END, max + (validDraft ? 20 : paddingMinutes));
  if (end - start < 120) {
    const mid = Math.round((start + end) / 2);
    start = Math.max(DAY_START, mid - 60);
    end = Math.min(DAY_END, mid + 60);
  }
  return {
    start: snapDown(start),
    end: Math.min(DAY_END, snapUp(end)),
  };
}

/** Inclusive duration: "08:00-08:39" is 40 minutes. */
export function inclusiveDurationMinutes(start: number, end: number): number {
  return end - start + 1;
}

export function suggestNextFreeSlot(
  rows: TemplateRow[],
  durationMinutes = DEFAULT_DURATION_MINUTES,
): string {
  const duration = Math.max(1, Math.floor(durationMinutes));
  const occupied = getOccupiedRanges(rows);

  if (occupied.length === 0) {
    const start = 8 * 60;
    const end = start + duration - 1;
    return `${formatMinutesOfDay(start)}-${formatMinutesOfDay(end)}`;
  }

  const lastEnd = occupied[occupied.length - 1]!.end;
  const tailStart = lastEnd + 1;
  const tailEnd = tailStart + duration - 1;
  if (tailStart >= SCHOOL_DAY_START && tailEnd <= DAY_END) {
    return `${formatMinutesOfDay(tailStart)}-${formatMinutesOfDay(tailEnd)}`;
  }

  const daytime = firstFittingGap(occupied, duration, 8 * 60, 22 * 60)
    ?? firstFittingGap(occupied, duration, SCHOOL_DAY_START, 22 * 60)
    ?? firstFittingGap(occupied, duration, DAY_START, DAY_END);
  if (daytime) return daytime;

  const end = DAY_END;
  const start = Math.max(DAY_START, end - duration + 1);
  return `${formatMinutesOfDay(start)}-${formatMinutesOfDay(end)}`;
}

function firstFittingGap(
  occupied: OccupiedRange[],
  duration: number,
  windowStart: number,
  windowEnd: number,
): string | null {
  let cursor = windowStart;
  for (const item of occupied) {
    if (item.end < windowStart) continue;
    const gapEnd = Math.min(item.start, windowEnd + 1) - 1;
    if (item.start > cursor && gapEnd - cursor + 1 >= duration) {
      const end = cursor + duration - 1;
      return `${formatMinutesOfDay(cursor)}-${formatMinutesOfDay(end)}`;
    }
    cursor = Math.max(cursor, item.end + 1);
    if (cursor > windowEnd) return null;
  }
  if (windowEnd - cursor + 1 >= duration) {
    const end = cursor + duration - 1;
    return `${formatMinutesOfDay(cursor)}-${formatMinutesOfDay(end)}`;
  }
  return null;
}

export function findNeighbors(
  occupied: OccupiedRange[],
  draft: { start: number; end: number },
): { previous: OccupiedRange | null; next: OccupiedRange | null } {
  let previous: OccupiedRange | null = null;
  let next: OccupiedRange | null = null;

  for (const item of occupied) {
    if (item.end < draft.start) previous = item;
    else if (item.start > draft.end && !next) next = item;
  }

  return { previous, next };
}

export type PlacementOption = {
  timeRange: string;
  start: number;
  end: number;
};

const SCHOOL_DAY_START = 6 * 60;
const MIN_GAP_MINUTES = 5;

function pushPlacement(
  candidates: PlacementOption[],
  start: number,
  end: number,
) {
  if (start < DAY_START || end > DAY_END || start >= end) return;
  const timeRange = `${formatMinutesOfDay(start)}-${formatMinutesOfDay(end)}`;
  if (candidates.some((item) => item.timeRange === timeRange)) return;
  candidates.push({ timeRange, start, end });
}

/** Nearby free slots that can take the current duration, closest to the draft first. */
export function findPlacementOptions(
  occupied: OccupiedRange[],
  durationMinutes: number,
  anchorMinutes: number,
  limit = 3,
): PlacementOption[] {
  const duration = Math.max(1, Math.floor(durationMinutes));
  const candidates: PlacementOption[] = [];

  function placeInGap(gapStart: number, gapEnd: number) {
    const gapDuration = gapEnd - gapStart + 1;
    if (gapDuration < MIN_GAP_MINUTES) return;
    if (gapDuration >= duration) {
      const start = anchorMinutes <= gapStart
        ? gapStart
        : Math.min(anchorMinutes, gapEnd - duration + 1);
      pushPlacement(candidates, start, start + duration - 1);
      return;
    }
    pushPlacement(candidates, gapStart, gapEnd);
  }

  if (occupied.length === 0) {
    const start = 8 * 60;
    pushPlacement(candidates, start, start + duration - 1);
    return candidates.slice(0, limit);
  }

  const first = occupied[0]!;
  const leadEnd = first.start - 1;
  const leadStart = leadEnd - duration + 1;
  if (leadStart >= SCHOOL_DAY_START) pushPlacement(candidates, leadStart, leadEnd);

  for (let index = 0; index < occupied.length - 1; index += 1) {
    placeInGap(occupied[index]!.end + 1, occupied[index + 1]!.start - 1);
  }

  const last = occupied[occupied.length - 1]!;
  const tailStart = last.end + 1;
  const tailEnd = tailStart + duration - 1;
  if (tailEnd <= DAY_END) pushPlacement(candidates, tailStart, tailEnd);
  else if (DAY_END - tailStart + 1 >= MIN_GAP_MINUTES) {
    pushPlacement(candidates, tailStart, DAY_END);
  }

  candidates.sort(
    (a, b) => Math.abs(a.start - anchorMinutes) - Math.abs(b.start - anchorMinutes) || a.start - b.start,
  );
  return candidates
    .filter((item) => findOverlap(occupied, item) === null)
    .slice(0, limit);
}

export type MinuteGap = {
  start: number;
  end: number;
};

export function gapContaining(occupied: OccupiedRange[], minute: number): MinuteGap | null {
  if (minute < DAY_START || minute > DAY_END) return null;
  let cursor = DAY_START;
  for (const item of occupied) {
    if (minute < item.start) {
      return cursor <= item.start - 1 ? { start: cursor, end: item.start - 1 } : null;
    }
    if (minute <= item.end) return null;
    cursor = Math.max(cursor, item.end + 1);
  }
  return cursor <= DAY_END ? { start: cursor, end: DAY_END } : null;
}

export function nearestGap(occupied: OccupiedRange[], minute: number): MinuteGap {
  const direct = gapContaining(occupied, minute);
  if (direct) return direct;
  const block = occupied.find((item) => minute >= item.start && minute <= item.end);
  if (!block) return { start: DAY_START, end: DAY_END };
  const before = block.start > DAY_START ? gapContaining(occupied, block.start - 1) : null;
  const after = block.end < DAY_END ? gapContaining(occupied, block.end + 1) : null;
  if (before && after) return minute - before.end <= after.start - minute ? before : after;
  return before ?? after ?? { start: DAY_START, end: DAY_END };
}

export function clampMove(
  gap: MinuteGap,
  start: number,
  end: number,
  delta: number,
): { start: number; end: number } {
  const span = end - start;
  const gapSpan = gap.end - gap.start;
  if (span > gapSpan) return { start: gap.start, end: gap.end };
  const nextStart = Math.max(gap.start, Math.min(gap.end - span, start + delta));
  return { start: nextStart, end: nextStart + span };
}

export function clampResize(
  gap: MinuteGap,
  start: number,
  end: number,
  edge: "start" | "end",
  minute: number,
  minInclusive = 5,
): { start: number; end: number } {
  const minSpan = Math.max(1, Math.min(end - start, minInclusive - 1));
  if (edge === "start") {
    const nextStart = Math.max(gap.start, Math.min(minute, end - minSpan));
    return { start: nextStart, end };
  }
  const nextEnd = Math.min(gap.end, Math.max(minute, start + minSpan));
  return { start, end: nextEnd };
}

export function nudgeRange(
  occupied: OccupiedRange[],
  draft: { start: number; end: number },
  delta: number,
): { start: number; end: number } {
  const midpoint = Math.round((draft.start + draft.end) / 2);
  const gap = gapContaining(occupied, midpoint) ?? nearestGap(occupied, midpoint);
  return clampMove(gap, draft.start, draft.end, delta);
}

export function stepEdge(
  occupied: OccupiedRange[],
  draft: { start: number; end: number },
  edge: "start" | "end",
  deltaMinutes: number,
): { start: number; end: number } {
  const midpoint = Math.round((draft.start + draft.end) / 2);
  const gap = gapContaining(occupied, midpoint);
  if (!gap) {
    return placeRangeAt(occupied, midpoint, draft.end - draft.start + 1) ?? draft;
  }
  return clampResize(gap, draft.start, draft.end, edge, (edge === "start" ? draft.start : draft.end) + deltaMinutes);
}

export function placeRangeAt(
  occupied: OccupiedRange[],
  minute: number,
  durationMinutes: number,
): { start: number; end: number } | null {
  const gap = gapContaining(occupied, minute) ?? nearestGap(occupied, minute);
  const gapDuration = gap.end - gap.start + 1;
  if (gapDuration < 2) return null;
  const duration = Math.max(2, Math.min(Math.floor(durationMinutes), gapDuration));
  const span = duration - 1;
  let start = Math.max(gap.start, minute);
  if (start + span > gap.end) start = gap.end - span;
  return { start, end: start + span };
}

export function rangeBetween(
  occupied: OccupiedRange[],
  anchor: number,
  current: number,
): { start: number; end: number } | null {
  const gap = gapContaining(occupied, anchor);
  if (!gap) return placeRangeAt(occupied, anchor, 40);
  let start = Math.max(gap.start, Math.min(anchor, current));
  let end = Math.min(gap.end, Math.max(anchor, current));
  if (end - start < 4) {
    end = Math.min(gap.end, start + 4);
    if (end - start < 4) start = Math.max(gap.start, end - 4);
  }
  if (end <= start) return null;
  return { start, end };
}

export function buildOccupancyHint(options: {
  draft: { start: number; end: number } | null;
  overlap: OccupiedRange | null;
  occupied: OccupiedRange[];
}): string {
  const { draft, overlap, occupied } = options;
  if (!draft || draft.start >= draft.end) {
    return "结束时间需要晚于开始时间";
  }

  const duration = inclusiveDurationMinutes(draft.start, draft.end);
  if (overlap) {
    return `与「${overlap.label}」重叠`;
  }

  if (occupied.length === 0) return `${duration} 分钟`;

  const { previous, next } = findNeighbors(occupied, draft);
  if (previous && next) return `${duration} 分钟 · ${previous.label} 与 ${next.label} 之间`;
  if (previous) return `${duration} 分钟 · ${previous.label} 之后`;
  if (next) return `${duration} 分钟 · ${next.label} 之前`;
  return `${duration} 分钟`;
}
