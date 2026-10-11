import { NextResponse } from "next/server";

import { handleScheduleGet } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const classId = await resolveDefaultClassId();
  return handleScheduleGet(classId);
}

export { NextResponse };
