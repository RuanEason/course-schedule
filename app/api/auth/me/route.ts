import { NextResponse } from "next/server";

import { handleMeGet } from "@/lib/api/handlers";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleMeGet();
}

export { NextResponse };
