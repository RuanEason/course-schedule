import { NextResponse } from "next/server";

import { handlePresenceDelete, handlePresenceGet, handlePresencePost } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/[class]/api/editor/presence">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handlePresenceGet(classId);
}

export async function POST(request: Request, ctx: RouteContext<"/[class]/api/editor/presence">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handlePresencePost(request, classId);
}

export async function DELETE(request: Request, ctx: RouteContext<"/[class]/api/editor/presence">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  return handlePresenceDelete(request, classId);
}

export { NextResponse };
