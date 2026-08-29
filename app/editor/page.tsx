import { notFound } from "next/navigation";

import { DingTalkAuth } from "@/components/dingtalk-auth";
import { EditorApp } from "@/components/editor-app";
import { getCurrentUser, toPublicUser } from "@/lib/auth";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { isEditorEnabled } from "@/lib/editor-access";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  if (!isEditorEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) {
    const config = getDingTalkPublicConfig();
    return <DingTalkAuth {...config} returnTo="/editor" />;
  }
  if (!user.canEdit) notFound();
  return <EditorApp user={toPublicUser(user)} />;
}
