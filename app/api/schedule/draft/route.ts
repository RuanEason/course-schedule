import { NextResponse } from "next/server";

import { handleDraftPut } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const classId = await resolveDefaultClassId();
  return handleDraftPut(request, classId);
}

export { NextResponse };
