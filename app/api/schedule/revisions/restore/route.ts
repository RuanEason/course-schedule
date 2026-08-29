import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import { restoreRevision } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as {
      revisionId?: unknown;
      expectedDraftVersion?: unknown;
    };
    if (typeof body.revisionId !== "number" || !Number.isInteger(body.revisionId)) {
      return NextResponse.json({ error: "版本编号无效" }, { status: 400 });
    }
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await restoreRevision(body.revisionId, expectedDraftVersion);
    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再恢复", current: result.current }, { status: 409 });
    }
    if (result.notFound) return NextResponse.json({ error: "版本快照不存在" }, { status: 404 });
    if (result.invalid) return NextResponse.json({ error: "版本快照无法恢复", issues: result.issues }, { status: 422 });
    return NextResponse.json({ current: result.current });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule revision restore failed", error);
    return NextResponse.json({ error: "恢复版本失败，请稍后重试" }, { status: 500 });
  }
}
