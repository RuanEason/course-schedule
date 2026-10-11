import { NextResponse } from "next/server";

import { resolveSegmentClassId } from "@/lib/api/class-route";
import { getPublishedConfig } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-cache",
};

/**
 * Per-class public config, at `/classN/config.json`.
 *
 * The Electron client fetches a flat path, so a class needs its own copy of the
 * contract rather than a query parameter. This mirrors `/config.json` exactly:
 * same unwrapped body, same CORS headers, same 503 on failure — including
 * passing no date, so a class returns the same flat board the default class
 * does.
 */
export async function GET(_request: Request, ctx: RouteContext<"/[class]/config.json">) {
  const { class: classSegment } = await ctx.params;
  const classId = await resolveSegmentClassId(classSegment);
  try {
    // No date on purpose: the published config is the flat weekly board the
    // client renders, with make-up-day substitution already applied at publish
    // time.
    const config = await getPublishedConfig(classId);
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
