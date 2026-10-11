import "server-only";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { CLASS_HEADER, DEFAULT_CLASS_ID, isValidClassSlug } from "@/lib/schedule/classes";

export interface ClassView {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSummary {
  id: string;
  name: string;
  displayOrder: number;
}

function toView(row: {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ClassView {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolve the class a request is about.
 *
 * The header is written by `proxy.ts` and is the only channel, so this must
 * tolerate its absence (direct handler invocation in tests, internal calls):
 * fall back to the configured default class rather than failing.
 *
 * The slug is pattern-checked here as well. Proxy is the intended writer, but a
 * forged header must still not be able to address arbitrary document ids — the
 * database id space is exactly the set of class slugs.
 */
export async function getRequestClassId(): Promise<string> {
  const headerStore = await headers();
  const candidate = headerStore.get(CLASS_HEADER)?.trim();
  if (candidate && (candidate === DEFAULT_CLASS_ID || isValidClassSlug(candidate))) return candidate;

  const configured = process.env.CLASS_CONFIG_SLUG?.trim();
  if (configured && (configured === DEFAULT_CLASS_ID || isValidClassSlug(configured))) return configured;
  return DEFAULT_CLASS_ID;
}

export async function classExists(classId: string): Promise<boolean> {
  const found = await prisma.class.findUnique({ where: { id: classId }, select: { id: true } });
  return Boolean(found);
}

export async function getClass(classId: string): Promise<ClassView | null> {
  const row = await prisma.class.findUnique({ where: { id: classId } });
  return row ? toView(row) : null;
}

export async function listClasses(options: { includeInactive?: boolean } = {}): Promise<ClassView[]> {
  const rows = await prisma.class.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

/**
 * Class ids a user may edit.
 *
 * Super admins are unrestricted and are reported as `["*"]` so callers do not
 * have to enumerate classes to answer "can this person edit everything".
 * `isSuperAdmin` lives on `CurrentUser`; `isAdmin`/`isBoss`/`isSenior` are the
 * raw DingTalk flags it is derived from, so both shapes are accepted.
 */
export async function getEditableClassIds(user: {
  id: string;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  isBoss?: boolean;
  isSenior?: boolean;
}): Promise<string[]> {
  if (isSuperAdminUser(user)) return ["*"];
  const memberships = await prisma.classMember.findMany({
    where: { userId: user.id, class: { isActive: true } },
    select: { classId: true },
  });
  const ids = memberships.map((membership) => membership.classId);
  // Mirrors the local-development fallback in `lib/auth.ts`: the mock dev user
  // has no rows in the membership table, so without this every class would
  // report an empty switcher and the UI would look broken during development.
  if (ids.length === 0 && user.id.startsWith("mock:")) {
    const configured = process.env.DINGTALK_DEV_USER_CLASSES?.trim();
    return configured
      ? configured.split(",").map((value) => value.trim()).filter(Boolean)
      : ["default"];
  }
  return ids;
}

function isSuperAdminUser(user: { isSuperAdmin?: boolean; isAdmin?: boolean; isBoss?: boolean; isSenior?: boolean }): boolean {
  return Boolean(user.isSuperAdmin || user.isAdmin || user.isBoss || user.isSenior);
}

/** Classes a user can switch between, plus the one the request was addressed to. */
export async function getClassSelection(user: {
  id: string;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  isBoss?: boolean;
  isSenior?: boolean;
}): Promise<{
  currentClassId: string;
  classes: ClassSummary[];
}> {
  const currentClassId = await getRequestClassId();
  const all = await listClasses();
  const editable = await getEditableClassIds(user);
  const visible = editable.includes("*") ? all : all.filter((item) => editable.includes(item.id));
  return {
    currentClassId,
    classes: visible.map((item) => ({ id: item.id, name: item.name, displayOrder: item.displayOrder })),
  };
}

export async function createClass(input: { id: string; name: string; displayOrder?: number }): Promise<ClassView> {
  const row = await prisma.class.create({
    data: {
      id: input.id,
      name: input.name,
      displayOrder: input.displayOrder ?? 0,
    },
  });
  return toView(row);
}

export async function updateClass(
  classId: string,
  patch: { name?: string; displayOrder?: number; isActive?: boolean },
): Promise<ClassView> {
  const row = await prisma.class.update({ where: { id: classId }, data: patch });
  return toView(row);
}

export async function setClassMembers(classId: string, userIds: readonly string[]): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.classMember.deleteMany({
      where: { classId, userId: { notIn: [...userIds] } },
    });
    for (const userId of userIds) {
      await transaction.classMember.upsert({
        where: { classId_userId: { classId, userId } },
        update: {},
        create: { classId, userId },
      });
    }
  });
}

export async function listClassMembers(classId: string): Promise<Array<{
  userId: string;
  name: string;
  userIdInCorp: string;
  title: string | null;
}>> {
  const rows = await prisma.classMember.findMany({
    where: { classId },
    include: { user: { select: { name: true, userId: true, title: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    userId: row.userId,
    name: row.user.name,
    userIdInCorp: row.user.userId,
    title: row.user.title,
  }));
}
