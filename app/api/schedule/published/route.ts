import { NextResponse } from "next/server";

import { authErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getPublishedConfig } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticatedUser();
    return NextResponse.json({ config: await getPublishedConfig() });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Published schedule failed", error);
    return NextResponse.json({ error: "暂时无法读取已发布课表" }, { status: 503 });
  }
}
