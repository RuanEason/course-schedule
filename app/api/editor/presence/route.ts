import { NextResponse } from "next/server";
import { z } from "zod";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import {
  heartbeatEditorPresence,
  listOnlineEditors,
  removeEditorPresence,
} from "@/lib/editor-presence";

export const dynamic = "force-dynamic";

const presenceSchema = z.object({
  presenceId: z.string().trim().min(8).max(128),
});

export async function GET() {
  try {
    const user = await requireEditor();
    return NextResponse.json({ users: await listOnlineEditors(user) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor presence lookup failed", error);
    return NextResponse.json({ error: "暂时无法读取在线编辑人员" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireEditor();
    const body = await request.json().catch(() => null);
    const result = presenceSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "编辑状态标识无效" }, { status: 422 });
    await heartbeatEditorPresence(user, result.data.presenceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor presence heartbeat failed", error);
    return NextResponse.json({ error: "无法更新编辑状态" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireEditor();
    const body = await request.json().catch(() => null);
    const result = presenceSchema.safeParse(body);
    if (!result.success) return NextResponse.json({ error: "编辑状态标识无效" }, { status: 422 });
    await removeEditorPresence(user, result.data.presenceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor presence removal failed", error);
    return NextResponse.json({ error: "无法清除编辑状态" }, { status: 500 });
  }
}
