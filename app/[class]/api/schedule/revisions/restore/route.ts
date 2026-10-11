import { NextResponse } from "next/server";

import { handleRevisionRestore } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: RouteContext<"/[class]/api/schedule/revisions/restore">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handleRevisionRestore(request, classId);
}

export { NextResponse };
