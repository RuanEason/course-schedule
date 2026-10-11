import { NextResponse } from "next/server";

import { handlePublishPost } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: RouteContext<"/[class]/api/schedule/publish">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handlePublishPost(request, classId);
}

export { NextResponse };
