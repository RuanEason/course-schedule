import { NextResponse } from "next/server";

import { handleClassMembersGet, handleClassMembersPut, handleClassUpdate } from "@/lib/api/handlers";
import { resolveSegmentClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/[class]/api/admin/classes/[classId]">) {
  const { class: classSegment, classId } = await ctx.params;
  await resolveSegmentClassId(classSegment);
  return handleClassMembersGet(classId);
}

export async function PATCH(request: Request, ctx: RouteContext<"/[class]/api/admin/classes/[classId]">) {
  const { class: classSegment, classId } = await ctx.params;
  await resolveSegmentClassId(classSegment);
  return handleClassUpdate(request, classId);
}

export async function PUT(request: Request, ctx: RouteContext<"/[class]/api/admin/classes/[classId]">) {
  const { class: classSegment, classId } = await ctx.params;
  await resolveSegmentClassId(classSegment);
  return handleClassMembersPut(request, classId);
}

export { NextResponse };
