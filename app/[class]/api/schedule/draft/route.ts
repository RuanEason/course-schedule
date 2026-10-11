import { NextResponse } from "next/server";

import { handleDraftPut } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, ctx: RouteContext<"/[class]/api/schedule/draft">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleDraftPut(request, classId);
}

export { NextResponse };
