import "server-only";

import { isMockUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveClassId } from "@/lib/schedule/repository";

export const PRESENCE_TTL_MS = 30_000;

export interface EditorPresenceView {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  lastSeenAt: string;
}

/**
 * The mock (local development) branch keeps presence in process memory. The key
 * includes the class so two classes opened against the same dev server do not
 * show each other's editors — that bleed-through would be invisible in
 * production and would quietly pass the isolation E2E tests.
 */
const mockPresences = new Map<string, EditorPresenceView>();

function mockKey(classId: string, userId: string, presenceId: string) {
  return `${classId}:${userId}:${presenceId}`;
}

function cutoffDate() {
  return new Date(Date.now() - PRESENCE_TTL_MS);
}

function toView(user: {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
}, lastSeenAt: Date): EditorPresenceView {
  return {
    userId: user.userId,
    name: user.name,
    title: user.title,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isAdmin || user.isBoss || user.isSenior,
    lastSeenAt: lastSeenAt.toISOString(),
  };
}

function cleanMockPresences(classId: string) {
  const cutoff = cutoffDate().getTime();
  const prefix = `${classId}:`;
  for (const [key, presence] of mockPresences) {
    if (!key.startsWith(prefix)) continue;
    if (new Date(presence.lastSeenAt).getTime() < cutoff) mockPresences.delete(key);
  }
}

export async function heartbeatEditorPresence(classIdInput: string, currentUser: CurrentUser, presenceId: string) {
  const classId = resolveClassId(classIdInput);
  const now = new Date();
  if (isMockUser(currentUser)) {
    cleanMockPresences(classId);
    mockPresences.set(mockKey(classId, currentUser.userId, presenceId), {
      userId: currentUser.userId,
      name: currentUser.name,
      title: currentUser.title,
      avatarUrl: currentUser.avatarUrl,
      isSuperAdmin: currentUser.isSuperAdmin,
      lastSeenAt: now.toISOString(),
    });
    return;
  }

  await prisma.editorPresence.deleteMany({ where: { lastSeenAt: { lt: cutoffDate() } } });
  await prisma.editorPresence.upsert({
    where: {
      classId_userId_presenceId: {
        classId,
        userId: currentUser.id,
        presenceId,
      },
    },
    update: { lastSeenAt: now },
    create: {
      classId,
      userId: currentUser.id,
      presenceId,
      lastSeenAt: now,
    },
  });
}

export async function removeEditorPresence(classIdInput: string, currentUser: CurrentUser, presenceId: string) {
  const classId = resolveClassId(classIdInput);
  if (isMockUser(currentUser)) {
    mockPresences.delete(mockKey(classId, currentUser.userId, presenceId));
    return;
  }
  await prisma.editorPresence.deleteMany({ where: { classId, userId: currentUser.id, presenceId } });
}

export async function listOnlineEditors(classIdInput: string, currentUser: CurrentUser): Promise<EditorPresenceView[]> {
  const classId = resolveClassId(classIdInput);
  const cutoff = cutoffDate();
  if (isMockUser(currentUser)) {
    cleanMockPresences(classId);
    const prefix = `${classId}:`;
    return [...mockPresences.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, presence]) => presence)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  await prisma.editorPresence.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  const rows = await prisma.editorPresence.findMany({
    where: { classId, lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    include: {
      user: {
        select: {
          userId: true,
          name: true,
          title: true,
          avatarUrl: true,
          isAdmin: true,
          isBoss: true,
          isSenior: true,
        },
      },
    },
  });

  const seenUsers = new Set<string>();
  return rows.reduce<EditorPresenceView[]>((result, row) => {
    if (seenUsers.has(row.user.userId)) return result;
    seenUsers.add(row.user.userId);
    result.push(toView(row.user, row.lastSeenAt));
    return result;
  }, []);
}
