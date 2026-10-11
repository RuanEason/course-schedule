import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { DEFAULT_CLASS_ID } from "./classes";
import {
  getAdjustmentChangedCells,
  getEffectiveConfigForDate,
  getEffectiveScheduleConfig,
  getScheduleWeekWindow,
  isAdjustmentActive,
  parseScheduleAdjustment,
  validateAdjustmentConfig,
} from "./adjustment";
import { createBlankConfig } from "./initial-config";
import { validateDayOverrides } from "./date-override";
import { normalizeScheduleConfig } from "./normalize";
import type {
  ScheduleConfig,
  ScheduleAdjustmentView,
  ScheduleDocumentView,
  ScheduleRevisionSource,
  ScheduleRevisionView,
} from "./types";
import { validateScheduleConfig } from "./validation";

/**
 * Every schedule row is partitioned by class id.
 *
 * `classId` is the `Class.id` and therefore also the `ScheduleDocument.id`; the
 * historical single schedule keeps the id `default`. There is deliberately no
 * "current class" module-level state here: each caller resolves the class from
 * the request and passes it down, so two classes can never be confused by a
 * shared mutable default.
 */
export type ClassId = string;

export function resolveClassId(classId?: string | null): ClassId {
  const candidate = classId?.trim();
  return candidate || DEFAULT_CLASS_ID;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asConfig(value: Prisma.JsonValue): ScheduleConfig {
  try {
    return normalizeScheduleConfig(value).config;
  } catch {
    throw new Error("数据库中的课表配置无效");
  }
}

function asAdjustmentView(
  value: Prisma.JsonValue | null,
  version: number,
  updatedAt: Date | null,
  publishedAt: Date | null,
): ScheduleAdjustmentView | null {
  if (!updatedAt) return null;
  const adjustment = parseScheduleAdjustment(value);
  if (!adjustment) return null;
  return {
    ...adjustment,
    version,
    status: publishedAt ? "active" : "draft",
    publishedAt: publishedAt?.toISOString() ?? null,
    updatedAt: updatedAt.toISOString(),
  };
}

function deriveAdjustmentChangedCells(
  adjustment: ScheduleAdjustmentView | null,
  baseConfig: ScheduleConfig,
): ScheduleAdjustmentView | null {
  if (!adjustment || adjustment.changedCells.length > 0) return adjustment;
  return {
    ...adjustment,
    changedCells: getAdjustmentChangedCells(baseConfig, adjustment.config, adjustment.weekIndex),
  };
}

/**
 * Returns the class's document, creating an empty one on first use.
 *
 * Lazy creation matters because classes are created through the admin UI and by
 * migration; someone must be able to open a brand-new class before any schedule
 * has been written for it.
 */
export async function ensureScheduleDocument(classIdInput?: string | null) {
  const classId = resolveClassId(classIdInput);
  const existing = await prisma.scheduleDocument.findUnique({ where: { id: classId } });
  if (existing) return existing;

  const config = createBlankConfig();
  try {
    return await prisma.scheduleDocument.create({
      data: {
        id: classId,
        draftConfig: toInputJson(config),
        publishedConfig: toInputJson(config),
        draftVersion: 1,
        publishedVersion: 1,
      },
    });
  } catch (error) {
    // Two first visitors can race here; the loser re-reads the winner's row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const created = await prisma.scheduleDocument.findUnique({ where: { id: classId } });
      if (created) return created;
    }
    throw error;
  }
}

export async function getScheduleDocumentView(classIdInput?: string | null): Promise<ScheduleDocumentView> {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  const currentWeek = getScheduleWeekWindow();
  const draftConfig = asConfig(document.draftConfig);
  const publishedConfig = asConfig(document.publishedConfig);
  const pendingAdjustment = deriveAdjustmentChangedCells(asAdjustmentView(
    document.temporaryAdjustment,
    document.temporaryAdjustmentVersion,
    document.temporaryAdjustmentUpdatedAt,
    null,
  ), draftConfig);
  const activeAdjustment = deriveAdjustmentChangedCells(asAdjustmentView(
    document.temporaryAdjustmentPublishedConfig ?? (
      document.temporaryAdjustmentPublishedAt ? document.temporaryAdjustment : null
    ),
    document.temporaryAdjustmentVersion,
    document.temporaryAdjustmentUpdatedAt,
    document.temporaryAdjustmentPublishedAt,
  ), publishedConfig);
  const currentPendingAdjustment = pendingAdjustment && isAdjustmentActive(pendingAdjustment) ? pendingAdjustment : null;
  const currentActiveAdjustment = activeAdjustment && isAdjustmentActive(activeAdjustment) ? activeAdjustment : null;
  return {
    draftConfig,
    publishedConfig,
    previousPublishedConfig: document.previousPublishedConfig ? asConfig(document.previousPublishedConfig) : null,
    draftVersion: document.draftVersion,
    publishedVersion: document.publishedVersion,
    publishedAt: document.publishedAt?.toISOString() ?? null,
    draftUpdatedAt: document.draftUpdatedAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    currentWeek,
    temporaryAdjustment: currentPendingAdjustment ?? currentActiveAdjustment,
    temporaryAdjustmentVersion: document.temporaryAdjustmentVersion,
    temporaryAdjustmentUpdatedAt: document.temporaryAdjustmentUpdatedAt?.toISOString() ?? null,
  };
}

export async function getPublishedConfig(classIdInput?: string | null, date?: string): Promise<ScheduleConfig> {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  const publishedConfig = asConfig(document.publishedConfig);
  const adjustment = parseScheduleAdjustment(document.temporaryAdjustmentPublishedConfig ?? (
    document.temporaryAdjustmentPublishedAt ? document.temporaryAdjustment : null
  ));
  const publishedAdjustment = document.temporaryAdjustmentPublishedAt ? adjustment : null;
  if (date) return getEffectiveConfigForDate(publishedConfig, publishedAdjustment, date);
  return getEffectiveScheduleConfig(publishedConfig, publishedAdjustment);
}

export async function saveDraft(classIdInput: string | null | undefined, config: ScheduleConfig, expectedDraftVersion?: number) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }

  const normalized = normalizeScheduleConfig(config).config;
  const updated = await prisma.scheduleDocument.update({
    where: { id: classId },
    data: {
      draftConfig: toInputJson(normalized),
      draftVersion: { increment: 1 },
      draftUpdatedAt: new Date(),
    },
  });
  return {
    conflict: false as const,
    draftVersion: updated.draftVersion,
    draftUpdatedAt: updated.draftUpdatedAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function saveTemporaryAdjustment(
  classIdInput: string | null | undefined,
  config: ScheduleConfig,
  weekStart: string,
  weekIndex: number,
  sourceDraftVersion: number,
  expectedAdjustmentVersion?: number,
  dayOverrides?: unknown,
) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  const currentWeek = getScheduleWeekWindow();
  if (weekStart !== currentWeek.start) {
    return { conflict: false as const, expired: true as const, currentWeek };
  }
  const expectedVersion = expectedAdjustmentVersion ?? document.temporaryAdjustmentVersion;
  if (expectedVersion !== document.temporaryAdjustmentVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }

  const normalized = normalizeScheduleConfig(config).config;
  const pendingAdjustment = parseScheduleAdjustment(document.temporaryAdjustment);
  const activeAdjustment = parseScheduleAdjustment(document.temporaryAdjustmentPublishedConfig ?? (
    document.temporaryAdjustmentPublishedAt ? document.temporaryAdjustment : null
  ));
  const continuingAdjustment = expectedVersion > 0
    ? pendingAdjustment && isAdjustmentActive(pendingAdjustment)
      ? pendingAdjustment
      : activeAdjustment && isAdjustmentActive(activeAdjustment)
        ? activeAdjustment
        : null
    : null;
  if (continuingAdjustment && weekIndex !== continuingAdjustment.weekIndex) {
    return {
      conflict: false as const,
      invalid: true as const,
      issues: [{ path: "weekIndex", message: `本周调课已锁定为第 ${continuingAdjustment.weekIndex + 1} 周` }],
    };
  }
  if (sourceDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }
  const baseConfig = asConfig(document.draftConfig);
  // Make-up days legitimately change a day's template, so they are checked
  // separately from the "courses only" rule below.
  const overrideValidation = validateDayOverrides(dayOverrides, normalized, weekStart);
  if (!overrideValidation.success) {
    return { conflict: false as const, invalid: true as const, issues: overrideValidation.issues };
  }
  const previousOverrides = continuingAdjustment?.dayOverrides;
  const adjustmentValidation = validateAdjustmentConfig(baseConfig, normalized, weekIndex, previousOverrides, weekStart);
  if (!adjustmentValidation.success) {
    return { conflict: false as const, invalid: true as const, issues: adjustmentValidation.issues };
  }

  const payload = {
    weekStart,
    weekIndex,
    sourceDraftVersion,
    config: normalized,
    changedCells: getAdjustmentChangedCells(baseConfig, normalized, weekIndex),
    ...(overrideValidation.data.length ? { dayOverrides: overrideValidation.data } : {}),
  };
  const updateWhere: Prisma.ScheduleDocumentWhereInput = {
    id: classId,
    temporaryAdjustmentVersion: expectedVersion,
    draftVersion: sourceDraftVersion,
  };
  const updatedCount = await prisma.scheduleDocument.updateMany({
    where: updateWhere,
    data: {
      temporaryAdjustment: toInputJson(payload),
      temporaryAdjustmentVersion: { increment: 1 },
      temporaryAdjustmentUpdatedAt: new Date(),
    },
  });
  if (updatedCount.count !== 1) return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  return { conflict: false as const, expired: false as const, invalid: false as const, current: await getScheduleDocumentView(classId) };
}

export async function clearTemporaryAdjustment(classIdInput: string | null | undefined, expectedAdjustmentVersion?: number) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  const expectedVersion = expectedAdjustmentVersion ?? document.temporaryAdjustmentVersion;
  if (expectedVersion !== document.temporaryAdjustmentVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }
  const updatedCount = await prisma.scheduleDocument.updateMany({
    where: { id: classId, temporaryAdjustmentVersion: expectedVersion },
    data: {
      temporaryAdjustment: Prisma.JsonNull,
      temporaryAdjustmentVersion: { increment: 1 },
      temporaryAdjustmentUpdatedAt: new Date(),
      temporaryAdjustmentPublishedAt: null,
      temporaryAdjustmentPublishedConfig: Prisma.JsonNull,
    },
  });
  if (updatedCount.count !== 1) return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  return { conflict: false as const, current: await getScheduleDocumentView(classId) };
}

function asRevisionView(revision: {
  id: number;
  draftVersion: number;
  publishedVersion: number | null;
  source: string;
  note: string | null;
  createdAt: Date;
}): ScheduleRevisionView {
  return {
    id: revision.id,
    draftVersion: revision.draftVersion,
    publishedVersion: revision.publishedVersion,
    source: revision.source as ScheduleRevisionSource,
    note: revision.note,
    createdAt: revision.createdAt.toISOString(),
  };
}

export async function listRevisions(classIdInput?: string | null): Promise<ScheduleRevisionView[]> {
  const classId = resolveClassId(classIdInput);
  await ensureScheduleDocument(classId);
  const revisions = await prisma.scheduleRevision.findMany({
    where: { documentId: classId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return revisions.map(asRevisionView);
}

export async function createDraftRevision(
  classIdInput: string | null | undefined,
  note?: string,
  expectedDraftVersion?: number,
) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }

  const revision = await prisma.scheduleRevision.create({
    data: {
      documentId: classId,
      draftVersion: document.draftVersion,
      publishedVersion: document.publishedVersion,
      config: toInputJson(asConfig(document.draftConfig)),
      source: "checkpoint",
      note: note || null,
    },
  });
  return { conflict: false as const, revision: asRevisionView(revision) };
}

export async function restoreRevision(
  classIdInput: string | null | undefined,
  revisionId: number,
  expectedDraftVersion?: number,
) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }

  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, documentId: classId },
  });
  if (!revision) return { conflict: false as const, notFound: true as const };

  const restored = asConfig(revision.config);
  const validation = validateScheduleConfig(restored);
  if (!validation.success) return { conflict: false as const, invalid: true as const, issues: validation.issues };

  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.scheduleDocument.update({
      where: { id: classId },
      data: {
        draftConfig: toInputJson(validation.data),
        draftVersion: { increment: 1 },
        draftUpdatedAt: new Date(),
      },
    });
    await transaction.scheduleRevision.create({
      data: {
        documentId: classId,
        draftVersion: updated.draftVersion,
        publishedVersion: updated.publishedVersion,
        config: toInputJson(validation.data),
        source: "restore",
        note: `恢复自快照 #${revision.id}`,
      },
    });
  });

  return { conflict: false as const, notFound: false as const, current: await getScheduleDocumentView(classId) };
}

export async function publishDraft(classIdInput: string | null | undefined, expectedDraftVersion?: number) {
  const classId = resolveClassId(classIdInput);
  const document = await ensureScheduleDocument(classId);
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView(classId) };
  }

  const draft = asConfig(document.draftConfig);
  const validation = validateScheduleConfig(draft);
  if (!validation.success) return { conflict: false as const, invalid: true as const, issues: validation.issues };
  const pendingAdjustment = parseScheduleAdjustment(document.temporaryAdjustment);
  const activeAdjustment = parseScheduleAdjustment(document.temporaryAdjustmentPublishedConfig ?? (
    document.temporaryAdjustmentPublishedAt ? document.temporaryAdjustment : null
  ));
  const pendingIsCurrent = pendingAdjustment && isAdjustmentActive(pendingAdjustment);
  const activeIsCurrent = activeAdjustment && document.temporaryAdjustmentPublishedAt && isAdjustmentActive(activeAdjustment);
  const nextActiveAdjustment = pendingIsCurrent ? pendingAdjustment : activeIsCurrent ? activeAdjustment : null;
  const temporaryAdjustmentPublishedAt = pendingIsCurrent
    ? new Date()
    : activeIsCurrent
      ? document.temporaryAdjustmentPublishedAt
      : null;
  const temporaryAdjustmentPublishedConfig = nextActiveAdjustment
    ? toInputJson(nextActiveAdjustment)
    : Prisma.JsonNull;
  const hasStaleAdjustmentState = Boolean(
    pendingAdjustment
    || (activeAdjustment && !activeIsCurrent)
    || (document.temporaryAdjustmentPublishedAt && !activeIsCurrent),
  );

  const updated = await prisma.$transaction(async (transaction) => {
    const next = await transaction.scheduleDocument.update({
      where: { id: classId },
      data: {
        previousPublishedConfig: toInputJson(document.publishedConfig),
        publishedConfig: toInputJson(validation.data),
        publishedVersion: { increment: 1 },
        publishedAt: new Date(),
        temporaryAdjustmentPublishedAt,
        temporaryAdjustmentPublishedConfig,
        ...(hasStaleAdjustmentState || pendingIsCurrent ? {
          temporaryAdjustment: Prisma.JsonNull,
          temporaryAdjustmentVersion: { increment: 1 },
          temporaryAdjustmentUpdatedAt: new Date(),
        } : {}),
      },
    });
    await transaction.scheduleRevision.create({
      data: {
        documentId: classId,
        draftVersion: next.draftVersion,
        publishedVersion: next.publishedVersion,
        config: toInputJson(validation.data),
        source: "publish",
        note: `发布 v${next.publishedVersion}`,
      },
    });
    return next;
  });
  const current = await getScheduleDocumentView(classId);
  return {
    conflict: false as const,
    invalid: false as const,
    publishedVersion: updated.publishedVersion,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
    current,
  };
}
