import { NextResponse } from "next/server";

import { handleRevisionsGet, handleRevisionCreate } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/[class]/api/schedule/revisions">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleRevisionsGet(classId);
}

export async function POST(request: Request, ctx: RouteContext<"/[class]/api/schedule/revisions">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleRevisionCreate(request, classId);
}

export { NextResponse };
