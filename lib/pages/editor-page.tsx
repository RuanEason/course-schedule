import { notFound } from "next/navigation";

import { DingTalkAuth } from "@/components/dingtalk-auth";
import { EditorApp } from "@/components/editor-app";
import { getCurrentUser, toPublicUser } from "@/lib/auth";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { isEditorEnabled } from "@/lib/editor-access";
import { canEditClass } from "@/lib/auth";
import { classBasePath } from "@/lib/schedule/classes";

/**
 * Editor page body, shared by `/editor` and `/classN/editor`.
 *
 * Access is checked against the class, not just the editor role: a homeroom
 * teacher of class 1 opening `/class2/editor` must not see class 2's draft.
 */
export async function EditorPage({ classId }: { classId: string }) {
  if (!isEditorEnabled()) notFound();
  const basePath = classBasePath(classId);
  const user = await getCurrentUser();
  if (!user) {
    const config = getDingTalkPublicConfig();
    return <DingTalkAuth {...config} basePath={basePath} returnTo="/editor" />;
  }
  if (!canEditClass(user, classId)) notFound();
  return <EditorApp user={toPublicUser(user)} basePath={basePath} classId={classId} />;
}
