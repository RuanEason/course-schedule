import { NextResponse } from "next/server";

import { handleRevisionRestore } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const classId = await resolveDefaultClassId();
  return handleRevisionRestore(request, classId);
}

export { NextResponse };
