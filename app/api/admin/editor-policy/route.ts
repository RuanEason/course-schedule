import { NextResponse } from "next/server";

import { handleEditorPolicyGet, handleEditorPolicyPut } from "@/lib/api/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleEditorPolicyGet();
}

export async function PUT(request: Request) {
  return handleEditorPolicyPut(request);
}

export { NextResponse };
