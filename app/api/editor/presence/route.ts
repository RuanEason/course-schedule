import { NextResponse } from "next/server";

import { handlePresenceDelete, handlePresenceGet, handlePresencePost } from "@/lib/api/handlers";
import { resolveDefaultClassId } from "@/lib/api/class-route";

export const dynamic = "force-dynamic";

export async function GET() {
  const classId = await resolveDefaultClassId();
  return handlePresenceGet(classId);
}

export async function POST(request: Request) {
  const classId = await resolveDefaultClassId();
  return handlePresencePost(request, classId);
}

export async function DELETE(request: Request) {
  const classId = await resolveDefaultClassId();
  return handlePresenceDelete(request, classId);
}

export { NextResponse };
