import { NextResponse } from "next/server";

import { handleAdjustmentDelete, handleAdjustmentPut } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, ctx: RouteContext<"/[class]/api/schedule/adjustment">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleAdjustmentPut(request, classId);
}

export async function DELETE(request: Request, ctx: RouteContext<"/[class]/api/schedule/adjustment">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleAdjustmentDelete(request, classId);
}

export { NextResponse };
