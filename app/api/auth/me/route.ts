import { NextResponse } from "next/server";

import { getCurrentUser, toPublicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先在钉钉内登录" }, { status: 401 });
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (error) {
    console.error("Current user lookup failed", error);
    return NextResponse.json({ error: "暂时无法读取当前用户" }, { status: 503 });
  }
}
