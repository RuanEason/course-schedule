import { NextResponse } from "next/server";

import { handleClassCreate, handleClassesGet } from "@/lib/api/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleClassesGet();
}

export async function POST(request: Request) {
  return handleClassCreate(request);
}

export { NextResponse };
