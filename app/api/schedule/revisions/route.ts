import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import { createDraftRevision, listRevisions } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireEditor();
    return NextResponse.json({ revisions: await listRevisions() });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule revisions failed", error);
    return NextResponse.json({ error: "无法读取版本历史" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as {
      expectedDraftVersion?: unknown;
      note?: unknown;
    };
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 191) || undefined : undefined;
    const result = await createDraftRevision(note, expectedDraftVersion);
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
