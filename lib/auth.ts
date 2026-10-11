import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isEditorEnabled } from "@/lib/editor-access";
import {
  canEditSchedule,
  DEFAULT_EDITOR_TITLES,
  isDingTalkBoolean,
  isSuperAdmin,
  normalizeEditorTitles,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CLASS_ID, isValidClassSlug } from "@/lib/schedule/classes";
import type { DingTalkProfile } from "@/lib/dingtalk";

export const SESSION_COOKIE_NAME = "class_schedule_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface PublicUser {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  canEdit: boolean;
  /** Class ids the user may edit; `["*"]` for super admins. Drives the class switcher. */
  editableClassIds: string[];
}

export interface CurrentUser extends PublicUser {
  id: string;
  corpId: string;
  unionId: string;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
  /** Class ids this user may edit. `["*"]` means every class (super admin). */
  editableClassIds: string[];
}

type StoredUser = {
  id: string;
  corpId: string;
  userId: string;
  unionId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
};

export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  };
}

function editorTitlesFromPolicy(value: unknown): string[] {
  const titles = normalizeEditorTitles(value);
  return titles.length > 0 || Array.isArray(value) ? titles : [...DEFAULT_EDITOR_TITLES];
}

export async function getEditorTitles(): Promise<string[]> {
  const policy = await prisma.editorAccessPolicy.findUnique({
    where: { id: "default" },
    select: { editorTitles: true },
  });
  return editorTitlesFromPolicy(policy?.editorTitles);
}

function toCurrentUser(
  user: StoredUser,
  editorTitles: readonly string[],
  editableClassIds: string[] = [],
): CurrentUser {
  const superAdmin = isSuperAdmin(user);
  const canEdit = isEditorEnabled() && canEditSchedule(user, editorTitles);
  return {
    id: user.id,
    corpId: user.corpId,
    userId: user.userId,
    unionId: user.unionId,
    name: user.name,
    title: user.title,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    isBoss: user.isBoss,
    isSenior: user.isSenior,
    isSuperAdmin: superAdmin,
    canEdit,
    editableClassIds: superAdmin ? ["*"] : editableClassIds,
  };
}

/**
 * Class memberships for a stored user.
 *
 * Queried on every resolution rather than cached in the session, so revoking a
 * class membership takes effect on the next request instead of at the next
 * login.
 */
async function editableClassIdsFor(user: StoredUser): Promise<string[]> {
  if (isSuperAdmin(user)) return ["*"];
  const memberships = await prisma.classMember.findMany({
    where: { userId: user.id },
    select: { classId: true },
  });
  const ids = memberships.map((membership) => membership.classId);
  // Local development (DINGTALK_DEV_AUTH) creates its user on the fly, so it is
  // never a member of anything and would be locked out of every class. Give it
  // the configured dev classes instead: `DINGTALK_DEV_USER_CLASSES="default,class2"`.
  if (ids.length === 0 && isMockUserStored(user)) {
    const configured = process.env.DINGTALK_DEV_USER_CLASSES?.trim();
    const ids = configured
      ? configured.split(",").map((value) => value.trim()).filter(Boolean)
      : [DEFAULT_CLASS_ID];
    return ids;
  }
  return ids;
}

function isMockUserStored(user: StoredUser): boolean {
  return user.id.startsWith("mock:");
}

function mockProfile(): DingTalkProfile | null {
  const enabled = isDingTalkBoolean(process.env.DINGTALK_DEV_AUTH);
  if (!enabled || !["development", "test"].includes(process.env.NODE_ENV)) return null;

  return {
    corpId: process.env.DINGTALK_CORP_ID?.trim() || "dev-corp",
    userId: process.env.DINGTALK_DEV_USER_ID?.trim() || "dev-user",
    unionId: process.env.DINGTALK_DEV_UNION_ID?.trim() || "dev-union-user",
    name: process.env.DINGTALK_DEV_USER_NAME?.trim() || "本地测试用户",
    title: process.env.DINGTALK_DEV_USER_TITLE?.trim() || "班主任",
    avatarUrl: null,
    isAdmin: isDingTalkBoolean(process.env.DINGTALK_DEV_USER_ADMIN),
    isBoss: isDingTalkBoolean(process.env.DINGTALK_DEV_USER_BOSS),
    isSenior: isDingTalkBoolean(process.env.DINGTALK_DEV_USER_SENIOR),
  };
}

function profileToStoredUser(profile: DingTalkProfile): StoredUser {
  return {
    id: `mock:${profile.corpId}:${profile.unionId}`,
    corpId: profile.corpId,
    userId: profile.userId,
    unionId: profile.unionId,
    name: profile.name,
    title: profile.title,
    avatarUrl: profile.avatarUrl,
    isAdmin: profile.isAdmin,
    isBoss: profile.isBoss,
    isSenior: profile.isSenior,
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const mock = mockProfile();
  if (mock) {
    const stored = profileToStoredUser(mock);
    return toCurrentUser(stored, await getEditorTitles(), await editableClassIdsFor(stored));
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return toCurrentUser(session.user, await getEditorTitles(), await editableClassIdsFor(session.user));
}

export async function requireAuthenticatedUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "请先在钉钉内登录");
  return user;
}

export async function requireEditor(): Promise<CurrentUser> {
  const user = await requireAuthenticatedUser();
  if (!isEditorEnabled()) throw new AuthError(403, "课表编辑功能当前已关闭");
  if (!user.canEdit) throw new AuthError(403, "当前职位没有课表编辑权限");
  return user;
}

/** True when the class slug is usable as a document id and as a URL segment. */
export function isAddressableClassId(classId: string): boolean {
  return classId === DEFAULT_CLASS_ID || isValidClassSlug(classId);
}

export function canEditClass(user: CurrentUser, classId: string): boolean {
  if (!isAddressableClassId(classId)) return false;
  if (!user.canEdit) return false;
  return user.editableClassIds.includes("*") || user.editableClassIds.includes(classId);
}

/**
 * Editor check scoped to one class.
 *
 * Being an editor is a company-wide property (job title), while access to a
 * class is a membership. Both must hold: a homeroom teacher of class 1 must not
 * be able to publish class 2's timetable by editing the URL.
 */
export async function requireClassEditor(classId: string): Promise<CurrentUser> {
  const user = await requireEditor();
  if (!canEditClass(user, classId)) {
    throw new AuthError(403, "当前账号没有该班级的课表编辑权限");
  }
  return user;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireAuthenticatedUser();
  if (!user.isSuperAdmin) throw new AuthError(403, "当前钉钉账号没有主管理员权限");
  return user;
}

export function authErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AuthError)) return null;
  return NextResponse.json({ error: error.message }, { status: error.status });
}

export function sameOriginError(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const configuredOrigin = process.env.APP_ORIGIN?.trim();
  if (!origin) {
    return process.env.NODE_ENV === "production"
      ? NextResponse.json({ error: "缺少请求来源" }, { status: 403 })
      : null;
  }

  let requestOrigin: string;
  try {
    requestOrigin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(request.url).origin;
  } catch {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  return origin === requestOrigin
    ? null
    : NextResponse.json({ error: "请求来源不受信任" }, { status: 403 });
}

export async function createDingTalkSession(profile: DingTalkProfile): Promise<CurrentUser> {
  const now = new Date();
  const user = await prisma.dingTalkUser.upsert({
    where: {
      corpId_unionId: {
        corpId: profile.corpId,
        unionId: profile.unionId,
      },
    },
    update: {
      userId: profile.userId,
      name: profile.name,
      title: profile.title,
      avatarUrl: profile.avatarUrl,
      isAdmin: profile.isAdmin,
      isBoss: profile.isBoss,
      isSenior: profile.isSenior,
      lastLoginAt: now,
      lastSyncedAt: now,
    },
    create: {
      corpId: profile.corpId,
      userId: profile.userId,
      unionId: profile.unionId,
      name: profile.name,
      title: profile.title,
      avatarUrl: profile.avatarUrl,
      isAdmin: profile.isAdmin,
      isBoss: profile.isBoss,
      isSenior: profile.isSenior,
      lastLoginAt: now,
      lastSyncedAt: now,
    },
  });

  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId: user.id,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(),
  });
  return toCurrentUser(user, await getEditorTitles(), await editableClassIdsFor(user));
}

export function toPublicUser(user: CurrentUser): PublicUser {
  return {
    userId: user.userId,
    name: user.name,
    title: user.title,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    canEdit: user.canEdit,
    editableClassIds: user.editableClassIds,
  };
}

export function isMockUser(user: CurrentUser): boolean {
  return user.id.startsWith("mock:");
}
