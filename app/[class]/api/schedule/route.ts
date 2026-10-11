import { NextResponse } from "next/server";

import { handleScheduleGet } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/[class]/api/schedule">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleScheduleGet(classId);
}

export { NextResponse };
