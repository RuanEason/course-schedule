import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import { publishDraft } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as { expectedDraftVersion?: unknown };
    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await publishDraft(expectedDraftVersion);

    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再发布", current: result.current }, { status: 409 });
    }
    if (result.invalid) {
      return NextResponse.json({ error: "草稿配置校验失败", issues: result.issues }, { status: 422 });
    }
    return NextResponse.json({
      publishedVersion: result.publishedVersion,
      publishedAt: result.publishedAt,
      current: result.current,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule publish failed", error);
    return NextResponse.json({ error: "发布失败，请稍后重试" }, { status: 500 });
  }
}
