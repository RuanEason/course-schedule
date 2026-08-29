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
import type { DingTalkProfile } from "@/lib/dingtalk";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "class_schedule_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface PublicUser {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  canEdit: boolean;
}

export interface CurrentUser extends PublicUser {
  id: string;
  corpId: string;
  unionId: string;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
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

function toCurrentUser(user: StoredUser, editorTitles: readonly string[]): CurrentUser {
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
  };
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
  if (mock) return toCurrentUser(profileToStoredUser(mock), await getEditorTitles());

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;
  return toCurrentUser(session.user, await getEditorTitles());
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
  return toCurrentUser(user, await getEditorTitles());
}

export function toPublicUser(user: CurrentUser): PublicUser {
  return {
    userId: user.userId,
    name: user.name,
    title: user.title,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    canEdit: user.canEdit,
  };
}

export function isMockUser(user: CurrentUser): boolean {
  return user.id.startsWith("mock:");
}
