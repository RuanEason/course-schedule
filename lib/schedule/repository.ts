import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  getAdjustmentChangedCells,
  getEffectiveScheduleConfig,
  getScheduleWeekWindow,
  isAdjustmentActive,
  parseScheduleAdjustment,
  validateAdjustmentConfig,
} from "./adjustment";
import { createBlankConfig } from "./initial-config";
import { normalizeScheduleConfig } from "./normalize";
import type {
  ScheduleConfig,
  ScheduleAdjustmentView,
  ScheduleDocumentView,
  ScheduleRevisionSource,
  ScheduleRevisionView,
} from "./types";
import { validateScheduleConfig } from "./validation";

const DOCUMENT_ID = "default";

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

export async function ensureScheduleDocument() {
  const existing = await prisma.scheduleDocument.findUnique({ where: { id: DOCUMENT_ID } });
  if (existing) return existing;

  const config = createBlankConfig();
  return prisma.scheduleDocument.create({
    data: {
      id: DOCUMENT_ID,
      draftConfig: toInputJson(config),
      publishedConfig: toInputJson(config),
      draftVersion: 1,
      publishedVersion: 1,
    },
  });
}

export async function getScheduleDocumentView(): Promise<ScheduleDocumentView> {
  const document = await ensureScheduleDocument();
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

export async function getPublishedConfig(): Promise<ScheduleConfig> {
  const document = await ensureScheduleDocument();
  const publishedConfig = asConfig(document.publishedConfig);
  const adjustment = parseScheduleAdjustment(document.temporaryAdjustmentPublishedConfig ?? (
    document.temporaryAdjustmentPublishedAt ? document.temporaryAdjustment : null
  ));
  const publishedAdjustment = document.temporaryAdjustmentPublishedAt ? adjustment : null;
  return getEffectiveScheduleConfig(publishedConfig, publishedAdjustment);
}

export async function saveDraft(config: ScheduleConfig, expectedDraftVersion?: number) {
  const document = await ensureScheduleDocument();
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
  }

  const normalized = normalizeScheduleConfig(config).config;
  const updated = await prisma.scheduleDocument.update({
    where: { id: "default" },
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
  config: ScheduleConfig,
  weekStart: string,
  weekIndex: number,
  sourceDraftVersion: number,
  expectedAdjustmentVersion?: number,
) {
  const document = await ensureScheduleDocument();
  const currentWeek = getScheduleWeekWindow();
  if (weekStart !== currentWeek.start) {
    return { conflict: false as const, expired: true as const, currentWeek };
  }
  const expectedVersion = expectedAdjustmentVersion ?? document.temporaryAdjustmentVersion;
  if (expectedVersion !== document.temporaryAdjustmentVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
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
    return { conflict: true as const, current: await getScheduleDocumentView() };
  }
  const baseConfig = asConfig(document.draftConfig);
  const adjustmentValidation = validateAdjustmentConfig(baseConfig, normalized, weekIndex);
  if (!adjustmentValidation.success) {
    return { conflict: false as const, invalid: true as const, issues: adjustmentValidation.issues };
  }

  const payload = {
    weekStart,
    weekIndex,
    sourceDraftVersion,
    config: normalized,
    changedCells: getAdjustmentChangedCells(baseConfig, normalized, weekIndex),
  };
  const updateWhere: Prisma.ScheduleDocumentWhereInput = {
    id: DOCUMENT_ID,
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
  if (updatedCount.count !== 1) return { conflict: true as const, current: await getScheduleDocumentView() };
  return { conflict: false as const, expired: false as const, invalid: false as const, current: await getScheduleDocumentView() };
}

export async function clearTemporaryAdjustment(expectedAdjustmentVersion?: number) {
  const document = await ensureScheduleDocument();
  const expectedVersion = expectedAdjustmentVersion ?? document.temporaryAdjustmentVersion;
  if (expectedVersion !== document.temporaryAdjustmentVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
  }
  const updatedCount = await prisma.scheduleDocument.updateMany({
    where: { id: DOCUMENT_ID, temporaryAdjustmentVersion: expectedVersion },
    data: {
      temporaryAdjustment: Prisma.JsonNull,
      temporaryAdjustmentVersion: { increment: 1 },
      temporaryAdjustmentUpdatedAt: new Date(),
      temporaryAdjustmentPublishedAt: null,
      temporaryAdjustmentPublishedConfig: Prisma.JsonNull,
    },
  });
  if (updatedCount.count !== 1) return { conflict: true as const, current: await getScheduleDocumentView() };
  return { conflict: false as const, current: await getScheduleDocumentView() };
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

export async function listRevisions(): Promise<ScheduleRevisionView[]> {
  await ensureScheduleDocument();
  const revisions = await prisma.scheduleRevision.findMany({
    where: { documentId: DOCUMENT_ID },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return revisions.map(asRevisionView);
}

export async function createDraftRevision(note?: string, expectedDraftVersion?: number) {
  const document = await ensureScheduleDocument();
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
  }

  const revision = await prisma.scheduleRevision.create({
    data: {
      documentId: DOCUMENT_ID,
      draftVersion: document.draftVersion,
      publishedVersion: document.publishedVersion,
      config: toInputJson(asConfig(document.draftConfig)),
      source: "checkpoint",
      note: note || null,
    },
  });
  return { conflict: false as const, revision: asRevisionView(revision) };
}

export async function restoreRevision(revisionId: number, expectedDraftVersion?: number) {
  const document = await ensureScheduleDocument();
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
  }

  const revision = await prisma.scheduleRevision.findFirst({
    where: { id: revisionId, documentId: DOCUMENT_ID },
  });
  if (!revision) return { conflict: false as const, notFound: true as const };

  const restored = asConfig(revision.config);
  const validation = validateScheduleConfig(restored);
  if (!validation.success) return { conflict: false as const, invalid: true as const, issues: validation.issues };

  await prisma.$transaction(async (transaction) => {
    const updated = await transaction.scheduleDocument.update({
      where: { id: DOCUMENT_ID },
      data: {
        draftConfig: toInputJson(validation.data),
        draftVersion: { increment: 1 },
        draftUpdatedAt: new Date(),
      },
    });
    await transaction.scheduleRevision.create({
      data: {
        documentId: DOCUMENT_ID,
        draftVersion: updated.draftVersion,
        publishedVersion: updated.publishedVersion,
        config: toInputJson(validation.data),
        source: "restore",
        note: `恢复自快照 #${revision.id}`,
      },
    });
  });

  return { conflict: false as const, notFound: false as const, current: await getScheduleDocumentView() };
}

export async function publishDraft(expectedDraftVersion?: number) {
  const document = await ensureScheduleDocument();
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== document.draftVersion) {
    return { conflict: true as const, current: await getScheduleDocumentView() };
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
      where: { id: DOCUMENT_ID },
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
        documentId: DOCUMENT_ID,
        draftVersion: next.draftVersion,
        publishedVersion: next.publishedVersion,
        config: toInputJson(validation.data),
        source: "publish",
        note: `发布 v${next.publishedVersion}`,
      },
    });
    return next;
  });
  const current = await getScheduleDocumentView();
  return {
    conflict: false as const,
    invalid: false as const,
    publishedVersion: updated.publishedVersion,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
    current,
  };
}
