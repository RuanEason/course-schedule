import { NextResponse } from "next/server";

import { getPublishedConfig } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-cache",
};

export async function GET() {
  try {
    const config = await getPublishedConfig();
    return new NextResponse(JSON.stringify(config), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Public schedule config failed", error);
    return new NextResponse(JSON.stringify({ error: "配置暂时不可用" }), {
      status: 503,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
