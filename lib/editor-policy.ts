import "server-only";

import { Prisma } from "@prisma/client";

import { DEFAULT_EDITOR_TITLES, normalizeEditorTitles } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export interface EditorAccessPolicyView {
  editorTitles: string[];
  updatedAt: string;
  updatedBy: { name: string; userId: string } | null;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseTitles(value: Prisma.JsonValue | null | undefined): string[] {
  if (Array.isArray(value)) return normalizeEditorTitles(value);
  return [...DEFAULT_EDITOR_TITLES];
}

function toPolicyView(policy: {
  editorTitles: Prisma.JsonValue;
  updatedAt: Date;
  updatedBy: { name: string; userId: string } | null;
}): EditorAccessPolicyView {
  return {
    editorTitles: parseTitles(policy.editorTitles),
    updatedAt: policy.updatedAt.toISOString(),
    updatedBy: policy.updatedBy,
  };
}

export async function getEditorAccessPolicy(): Promise<EditorAccessPolicyView> {
  const policy = await prisma.editorAccessPolicy.findUnique({
    where: { id: "default" },
    include: {
      updatedBy: {
        select: { name: true, userId: true },
      },
    },
  });

  if (!policy) {
    return {
      editorTitles: [...DEFAULT_EDITOR_TITLES],
      updatedAt: new Date(0).toISOString(),
      updatedBy: null,
    };
  }
  return toPolicyView(policy);
}

export async function updateEditorAccessPolicy(editorTitles: readonly string[], updatedByUserId: string | null) {
  const normalizedTitles = normalizeEditorTitles(editorTitles);
  const policy = await prisma.editorAccessPolicy.upsert({
    where: { id: "default" },
    update: {
      editorTitles: toInputJson(normalizedTitles),
      updatedByUserId,
    },
    create: {
      id: "default",
      editorTitles: toInputJson(normalizedTitles),
      updatedByUserId,
    },
    include: {
      updatedBy: {
        select: { name: true, userId: true },
      },
    },
  });
  return toPolicyView(policy);
}
