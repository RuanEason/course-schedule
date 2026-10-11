import { NextResponse } from "next/server";

import { handleAdjustmentDelete, handleAdjustmentPut } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const classId = await resolveDefaultClassId();
  return handleAdjustmentPut(request, classId);
}

export async function DELETE(request: Request) {
  const classId = await resolveDefaultClassId();
  return handleAdjustmentDelete(request, classId);
}

export { NextResponse };
