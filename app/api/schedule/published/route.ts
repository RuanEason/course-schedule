import { NextResponse } from "next/server";

import { handlePublishedGet } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const classId = await resolveDefaultClassId();
  return handlePublishedGet(classId);
}

export { NextResponse };
