import { NextResponse } from "next/server";

import { handleClassMembersGet, handleClassMembersPut, handleClassUpdate } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/admin/classes/[classId]">) {
  const { classId } = await ctx.params;
  await resolveDefaultClassId();
  return handleClassMembersGet(classId);
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/admin/classes/[classId]">) {
  const { classId } = await ctx.params;
  await resolveDefaultClassId();
  return handleClassUpdate(request, classId);
}

export async function PUT(request: Request, ctx: RouteContext<"/api/admin/classes/[classId]">) {
  const { classId } = await ctx.params;
  await resolveDefaultClassId();
  return handleClassMembersPut(request, classId);
}

export { NextResponse };
