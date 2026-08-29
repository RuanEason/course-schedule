import { NextResponse } from "next/server";

import { authErrorResponse, requireEditor } from "@/lib/auth";
import { getScheduleDocumentView } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireEditor();
    return NextResponse.json(await getScheduleDocumentView());
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Schedule document failed", error);
    return NextResponse.json({ error: "无法读取课表，请检查数据库连接" }, { status: 503 });
  }
}
