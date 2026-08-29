import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", time: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
