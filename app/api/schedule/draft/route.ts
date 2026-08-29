import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import { saveDraft } from "@/lib/schedule/repository";
import { validateScheduleConfig } from "@/lib/schedule/validation";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json()) as { config?: unknown; expectedDraftVersion?: unknown };
    const validation = validateScheduleConfig(body.config);
    if (!validation.success) {
      return NextResponse.json({ error: "课表配置校验失败", issues: validation.issues }, { status: 422 });
    }

    const expectedDraftVersion = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : undefined;
    const result = await saveDraft(validation.data, expectedDraftVersion);
    if (result.conflict) {
      return NextResponse.json({ error: "草稿已被更新，请重新加载后再保存", current: result.current }, { status: 409 });
    }
    return NextResponse.json({
      draftVersion: result.draftVersion,
      draftUpdatedAt: result.draftUpdatedAt,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Draft save failed", error);
    return NextResponse.json({ error: "保存草稿失败，请稍后重试" }, { status: 500 });
  }
}
