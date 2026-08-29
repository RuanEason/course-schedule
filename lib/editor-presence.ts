import "server-only";

import { isMockUser } from "@/lib/auth";
import type { CurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const PRESENCE_TTL_MS = 30_000;

export interface EditorPresenceView {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  lastSeenAt: string;
}

const mockPresences = new Map<string, EditorPresenceView>();

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

function cleanMockPresences() {
  const cutoff = cutoffDate().getTime();
  for (const [key, presence] of mockPresences) {
    if (new Date(presence.lastSeenAt).getTime() < cutoff) mockPresences.delete(key);
  }
}

export async function heartbeatEditorPresence(currentUser: CurrentUser, presenceId: string) {
  const now = new Date();
  if (isMockUser(currentUser)) {
    cleanMockPresences();
    mockPresences.set(`${currentUser.userId}:${presenceId}`, {
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
      userId_presenceId: {
        userId: currentUser.id,
        presenceId,
      },
    },
    update: { lastSeenAt: now },
    create: {
      userId: currentUser.id,
      presenceId,
      lastSeenAt: now,
    },
  });
}

export async function removeEditorPresence(currentUser: CurrentUser, presenceId: string) {
  if (isMockUser(currentUser)) {
    mockPresences.delete(`${currentUser.userId}:${presenceId}`);
    return;
  }
  await prisma.editorPresence.deleteMany({ where: { userId: currentUser.id, presenceId } });
}

export async function listOnlineEditors(currentUser: CurrentUser): Promise<EditorPresenceView[]> {
  const cutoff = cutoffDate();
  if (isMockUser(currentUser)) {
    cleanMockPresences();
    return [...mockPresences.values()]
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  }

  await prisma.editorPresence.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  const rows = await prisma.editorPresence.findMany({
    where: { lastSeenAt: { gte: cutoff } },
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
