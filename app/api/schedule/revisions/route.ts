import { NextResponse } from "next/server";

import { handleRevisionsGet, handleRevisionCreate } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const classId = await resolveDefaultClassId();
  return handleRevisionsGet(classId);
}

export async function POST(request: Request) {
  const classId = await resolveDefaultClassId();
  return handleRevisionCreate(request, classId);
}

export { NextResponse };
