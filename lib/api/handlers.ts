import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authErrorResponse,
  isMockUser,
  requireAuthenticatedUser,
  requireClassEditor,
  requireSuperAdmin,
  sameOriginError,
  toPublicUser,
} from "@/lib/auth";
import { getEditorAccessPolicy, updateEditorAccessPolicy } from "@/lib/editor-policy";
import {
  heartbeatEditorPresence,
  listOnlineEditors,
  removeEditorPresence,
} from "@/lib/editor-presence";
import { prisma } from "@/lib/prisma";
import {
  classExists,
  createClass,
  getClass,
  getClassSelection,
  listClassMembers,
  listClasses,
  setClassMembers,
  updateClass,
} from "@/lib/schedule/class-context";
import { CLASS_SLUG_SOURCE, DEFAULT_CLASS_ID, isValidClassSlug } from "@/lib/schedule/classes";
import { getScheduleWeekWindow } from "@/lib/schedule/adjustment";
import {
  clearTemporaryAdjustment,
  createDraftRevision,
  getPublishedConfig,
  getScheduleDocumentView,
  listRevisions,
  publishDraft,
  restoreRevision,
  saveDraft,
  saveTemporaryAdjustment,
} from "@/lib/schedule/repository";
import { validateScheduleConfig } from "@/lib/schedule/validation";

/**
 * Route bodies, parameterised by class.
 *
 * The route files under `app/api/**` and `app/[class]/api/**` are thin adapters
 * over these functions: the first serves the default class on the historical
 * unprefixed paths, the second serves `/classN/api/**`. Keeping the logic here
 * means the per-class route tree never duplicates a handler, and that
 * `sameOriginError` sees exactly one origin story for both trees.
 */

const presenceSchema = z.object({
  presenceId: z.string().trim().min(8).max(128),
});

const policySchema = z.object({
  editorTitles: z.array(z.string().trim().min(1).max(80)).max(50),
});

const classSchema = z.object({
  id: z.string().trim().regex(new RegExp(CLASS_SLUG_SOURCE), "班级标识必须形如 class2"),
  name: z.string().trim().min(1).max(80),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const classPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const membersSchema = z.object({
  userIds: z.array(z.string().trim().min(1)).max(500),
});

function unavailable(message: string, error: unknown, label: string) {
  console.error(label, error);
  return NextResponse.json({ error: message }, { status: 503 });
}

/* ------------------------------------------------------------------ schedule */

export async function handleScheduleGet(classId: string) {
  try {
    await requireClassEditor(classId);
    return NextResponse.json(await getScheduleDocumentView(classId));
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("无法读取课表，请检查数据库连接", error, "Schedule document failed");
  }
}

export async function handleDraftPut(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json()) as { config?: unknown; expectedDraftVersion?: unknown };
    const validation = validateScheduleConfig(body.config);
    if (!validation.success) {
      return NextResponse.json({ error: "课表配置校验失败", issues: validation.issues }, { status: 422 });
    }

    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await saveDraft(classId, validation.data, expectedDraftVersion);
    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再保存", current: result.current }, { status: 409 });
    }
    return NextResponse.json({
      draftVersion: result.draftVersion,
      draftUpdatedAt: result.draftUpdatedAt,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Draft save failed", error);
    return NextResponse.json({ error: "保存草稿失败，请稍后重试" }, { status: 500 });
  }
}

export async function handlePublishPost(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json().catch(() => ({}))) as { expectedDraftVersion?: unknown };
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await publishDraft(classId, expectedDraftVersion);

    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再发布", current: result.current }, { status: 409 });
    }
    if (result.invalid) {
      return NextResponse.json({ error: "草稿配置校验失败", issues: result.issues }, { status: 422 });
    }
    return NextResponse.json({
      publishedVersion: result.publishedVersion,
      publishedAt: result.publishedAt,
      current: result.current,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule publish failed", error);
    return NextResponse.json({ error: "发布失败，请稍后重试" }, { status: 500 });
  }
}

export async function handleRevisionsGet(classId: string) {
  try {
    await requireClassEditor(classId);
    return NextResponse.json({ revisions: await listRevisions(classId) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("无法读取版本历史", error, "Schedule revisions failed");
  }
}

export async function handleRevisionCreate(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json().catch(() => ({}))) as { note?: unknown; expectedDraftVersion?: unknown };
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 191) || undefined : undefined;
    const result = await createDraftRevision(classId, note, expectedDraftVersion);
    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再创建快照", current: result.current }, { status: 409 });
    }
    return NextResponse.json({ revision: result.revision }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule revision creation failed", error);
    return NextResponse.json({ error: "创建版本快照失败，请稍后重试" }, { status: 500 });
  }
}

export async function handleRevisionRestore(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json().catch(() => ({}))) as { revisionId?: unknown; expectedDraftVersion?: unknown };
    if (typeof body.revisionId !== "number" || !Number.isInteger(body.revisionId)) {
      return NextResponse.json({ error: "版本编号无效" }, { status: 400 });
    }
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await restoreRevision(classId, body.revisionId, expectedDraftVersion);
    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再恢复", current: result.current }, { status: 409 });
    }
    if (result.notFound) return NextResponse.json({ error: "版本快照不存在" }, { status: 404 });
    if (result.invalid) return NextResponse.json({ error: "版本快照无法恢复", issues: result.issues }, { status: 422 });
    return NextResponse.json({ current: result.current });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule revision restore failed", error);
    return NextResponse.json({ error: "恢复版本失败，请稍后重试" }, { status: 500 });
  }
}

export async function handleAdjustmentPut(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json()) as {
      config?: unknown;
      weekStart?: unknown;
      weekIndex?: unknown;
      sourceDraftVersion?: unknown;
      expectedAdjustmentVersion?: unknown;
      dayOverrides?: unknown;
    };
    const validation = validateScheduleConfig(body.config);
    if (!validation.success) {
      return NextResponse.json({ error: "临时课表配置校验失败", issues: validation.issues }, { status: 422 });
    }
    if (typeof body.weekStart !== "string" || body.weekStart !== getScheduleWeekWindow().start) {
      return NextResponse.json({ error: "调课仅在当前自然周内有效", currentWeek: getScheduleWeekWindow() }, { status: 422 });
    }
    if (typeof body.weekIndex !== "number" || !Number.isInteger(body.weekIndex) || body.weekIndex < 0 || body.weekIndex > 3) {
      return NextResponse.json({ error: "请选择有效的轮换周次" }, { status: 422 });
    }
    if (typeof body.sourceDraftVersion !== "number" || !Number.isInteger(body.sourceDraftVersion) || body.sourceDraftVersion < 1) {
      return NextResponse.json({ error: "缺少调课基线版本" }, { status: 422 });
    }
    const expectedAdjustmentVersion = typeof body.expectedAdjustmentVersion === "number"
      ? body.expectedAdjustmentVersion
      : undefined;
    const result = await saveTemporaryAdjustment(
      classId,
      validation.data,
      body.weekStart,
      body.weekIndex,
      body.sourceDraftVersion,
      expectedAdjustmentVersion,
      body.dayOverrides,
    );
    if (result.conflict) return NextResponse.json({ error: "临时调课已在别处更新", current: result.current }, { status: 409 });
    if (result.expired) return NextResponse.json({ error: "本周调课已过期", currentWeek: result.currentWeek }, { status: 422 });
    if (result.invalid) return NextResponse.json({ error: "调课只能修改锁定轮换周的课程安排", issues: result.issues }, { status: 422 });
    return NextResponse.json({
      temporaryAdjustment: result.current.temporaryAdjustment,
      temporaryAdjustmentVersion: result.current.temporaryAdjustmentVersion,
      temporaryAdjustmentUpdatedAt: result.current.temporaryAdjustmentUpdatedAt,
      currentWeek: result.current.currentWeek,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Temporary schedule adjustment save failed", error);
    return NextResponse.json({ error: "保存调课失败，请稍后重试" }, { status: 500 });
  }
}

export async function handleAdjustmentDelete(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireClassEditor(classId);
    const body = (await request.json().catch(() => ({}))) as { expectedAdjustmentVersion?: unknown };
    const expectedAdjustmentVersion = typeof body.expectedAdjustmentVersion === "number"
      ? body.expectedAdjustmentVersion
      : undefined;
    const result = await clearTemporaryAdjustment(classId, expectedAdjustmentVersion);
    if (result.conflict) return NextResponse.json({ error: "临时调课已在别处更新", current: result.current }, { status: 409 });
    return NextResponse.json({
      temporaryAdjustment: result.current.temporaryAdjustment,
      temporaryAdjustmentVersion: result.current.temporaryAdjustmentVersion,
      temporaryAdjustmentUpdatedAt: result.current.temporaryAdjustmentUpdatedAt,
      currentWeek: result.current.currentWeek,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Temporary schedule adjustment clear failed", error);
    return NextResponse.json({ error: "清除调课失败，请稍后重试" }, { status: 500 });
  }
}

export async function handlePublishedGet(classId: string) {
  try {
    await requireAuthenticatedUser();
    return NextResponse.json({ config: await getPublishedConfig(classId) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取已发布课表", error, "Published schedule failed");
  }
}

/* ------------------------------------------------------------------ presence */

export async function handlePresenceGet(classId: string) {
  try {
    const user = await requireClassEditor(classId);
    return NextResponse.json({ users: await listOnlineEditors(classId, user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取在线编辑人员", error, "Editor presence lookup failed");
  }
}

export async function handlePresencePost(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireClassEditor(classId);
    const body = await request.json().catch(() => null);
    const result = presenceSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "编辑状态标识无效" }, { status: 422 });
    await heartbeatEditorPresence(classId, user, result.data.presenceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor presence heartbeat failed", error);
    return NextResponse.json({ error: "无法更新编辑状态" }, { status: 500 });
  }
}

export async function handlePresenceDelete(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireClassEditor(classId);
    const body = await request.json().catch(() => null);
    const result = presenceSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "编辑状态标识无效" }, { status: 422 });
    await removeEditorPresence(classId, user, result.data.presenceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor presence removal failed", error);
    return NextResponse.json({ error: "无法清除编辑状态" }, { status: 500 });
  }
}

/* --------------------------------------------------------------------- admin */

export async function handleClassesGet() {
  try {
    const user = await requireAuthenticatedUser();
    const selection = await getClassSelection(user);
    const all = user.isSuperAdmin ? await listClasses({ includeInactive: true }) : null;
    return NextResponse.json({
      currentClassId: selection.currentClassId,
      classes: selection.classes,
      all: all?.map((item) => ({ id: item.id, name: item.name, displayOrder: item.displayOrder, isActive: item.isActive })) ?? null,
      defaultClassId: DEFAULT_CLASS_ID,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取班级列表", error, "Class list failed");
  }
}

export async function handleClassCreate(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireSuperAdmin();
    const body = await request.json().catch(() => null);
    const result = classSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({
        error: "班级信息无效",
        issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, { status: 422 });
    }
    if (await classExists(result.data.id)) {
      return NextResponse.json({ error: `班级 ${result.data.id} 已存在` }, { status: 409 });
    }
    const created = await createClass(result.data);
    return NextResponse.json({ class: created });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Class create failed", error);
    return NextResponse.json({ error: "创建班级失败" }, { status: 500 });
  }
}

export async function handleClassUpdate(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireSuperAdmin();
    if (!(await classExists(classId))) return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const result = classPatchSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "班级信息无效" }, { status: 422 });
    const updated = await updateClass(classId, result.data);
    return NextResponse.json({ class: updated });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Class update failed", error);
    return NextResponse.json({ error: "更新班级失败" }, { status: 500 });
  }
}

export async function handleClassMembersGet(classId: string) {
  try {
    await requireSuperAdmin();
    if (!(await classExists(classId))) return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    return NextResponse.json({ members: await listClassMembers(classId) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取班级成员", error, "Class members failed");
  }
}

export async function handleClassMembersPut(request: Request, classId: string) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireSuperAdmin();
    if (!(await classExists(classId))) return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    const body = await request.json().catch(() => null);
    const result = membersSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "成员列表无效" }, { status: 422 });

    // Only known DingTalk users can be members; the id space is internal.
    const known = await prisma.dingTalkUser.findMany({
      where: { id: { in: [...result.data.userIds] } },
      select: { id: true },
    });
    await setClassMembers(classId, known.map((user) => user.id));
    return NextResponse.json({ members: await listClassMembers(classId) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Class members update failed", error);
    return NextResponse.json({ error: "保存班级成员失败" }, { status: 500 });
  }
}

export async function handleEditorPolicyGet() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(await getEditorAccessPolicy());
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取编辑权限设置", error, "Editor policy lookup failed");
  }
}

export async function handleEditorPolicyPut(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireSuperAdmin();
    const body = await request.json().catch(() => null);
    const result = policySchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({
        error: "职位列表格式无效",
        issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, { status: 422 });
    }

    const policy = await updateEditorAccessPolicy(result.data.editorTitles, isMockUser(user) ? null : user.id);
    return NextResponse.json(policy);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor policy update failed", error);
    return NextResponse.json({ error: "保存编辑权限设置失败" }, { status: 500 });
  }
}

export async function handleMeGet() {
  try {
    const user = await requireAuthenticatedUser();
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    return unavailable("暂时无法读取当前用户", error, "Current user lookup failed");
  }
}

/** Used by the per-class pages to decide between 404 and a rendered editor. */
export async function classIsAddressable(classId: string): Promise<boolean> {
  if (classId !== DEFAULT_CLASS_ID && !isValidClassSlug(classId)) return false;
  return classExists(classId);
}

export { getClass, isValidClassSlug };
