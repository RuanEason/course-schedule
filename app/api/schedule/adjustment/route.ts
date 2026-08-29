import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor, sameOriginError } from "@/lib/auth";
import { getScheduleWeekWindow } from "@/lib/schedule/adjustment";
import {
  clearTemporaryAdjustment,
  getScheduleDocumentView,
  saveTemporaryAdjustment,
} from "@/lib/schedule/repository";
import { validateScheduleConfig } from "@/lib/schedule/validation";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json()) as {
      config?: unknown;
      weekStart?: unknown;
      weekIndex?: unknown;
      sourceDraftVersion?: unknown;
      expectedAdjustmentVersion?: unknown;
    };
    const validation = validateScheduleConfig(body.config);
    if (!validation.success) {
      return NextResponse.json({ error: "临时课表配置校验失败", issues: validation.issues }, { status: 422 });
    }
    if (typeof body.weekStart !== "string" || body.weekStart !== getScheduleWeekWindow().start) {
      return NextResponse.json({ error: "调课仅在当前自然周内有效", currentWeek: getScheduleWeekWindow() }, { status: 422 });
    }
    if (typeof body.weekIndex !== "number" || !Number.isInteger(body.weekIndex) || body.weekIndex < 0 || body.weekIndex > 3) {
      return NextResponse.json({ error: "请选择有效的轮换周次" }, { status: 422 });
    }
    if (typeof body.sourceDraftVersion !== "number" || !Number.isInteger(body.sourceDraftVersion) || body.sourceDraftVersion < 1) {
      return NextResponse.json({ error: "缺少调课基线版本" }, { status: 422 });
    }
    const expectedAdjustmentVersion = typeof body.expectedAdjustmentVersion === "number"
      ? body.expectedAdjustmentVersion
      : undefined;
    const result = await saveTemporaryAdjustment(
      validation.data,
      body.weekStart,
      body.weekIndex,
      body.sourceDraftVersion,
      expectedAdjustmentVersion,
    );
    if (result.conflict) return NextResponse.json({ error: "临时调课已在别处更新", current: result.current }, { status: 409 });
    if (result.expired) return NextResponse.json({ error: "本周调课已过期", currentWeek: result.currentWeek }, { status: 422 });
    if (result.invalid) return NextResponse.json({ error: "调课只能修改锁定轮换周的课程安排", issues: result.issues }, { status: 422 });
    return NextResponse.json({
      temporaryAdjustment: result.current.temporaryAdjustment,
      temporaryAdjustmentVersion: result.current.temporaryAdjustmentVersion,
      temporaryAdjustmentUpdatedAt: result.current.temporaryAdjustmentUpdatedAt,
      currentWeek: result.current.currentWeek,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Temporary schedule adjustment save failed", error);
    return NextResponse.json({ error: "保存调课失败，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    await requireEditor();
    const body = (await request.json().catch(() => ({}))) as { expectedAdjustmentVersion?: unknown };
    const expectedAdjustmentVersion = typeof body.expectedAdjustmentVersion === "number"
      ? body.expectedAdjustmentVersion
      : undefined;
    const result = await clearTemporaryAdjustment(expectedAdjustmentVersion);
    if (result.conflict) return NextResponse.json({ error: "临时调课已在别处更新", current: result.current }, { status: 409 });
    return NextResponse.json({
      temporaryAdjustment: result.current.temporaryAdjustment,
      temporaryAdjustmentVersion: result.current.temporaryAdjustmentVersion,
      temporaryAdjustmentUpdatedAt: result.current.temporaryAdjustmentUpdatedAt,
      currentWeek: result.current.currentWeek,
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Temporary schedule adjustment clear failed", error);
    return NextResponse.json({ error: "清除调课失败，请稍后重试" }, { status: 500 });
  }
}
