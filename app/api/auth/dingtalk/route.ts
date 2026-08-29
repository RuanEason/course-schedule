import { NextResponse } from "next/server";

import { createDingTalkSession, sameOriginError, toPublicUser } from "@/lib/auth";
import { DingTalkApiError, fetchDingTalkProfile } from "@/lib/dingtalk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const body = await request.json().catch(() => null) as { code?: unknown } | null;
    if (!body || typeof body.code !== "string" || !body.code.trim() || body.code.length > 4096) {
      return NextResponse.json({ error: "钉钉免登码无效" }, { status: 400 });
    }

    const profile = await fetchDingTalkProfile(body.code);
    const user = await createDingTalkSession(profile);
    return NextResponse.json({ user: toPublicUser(user) });
  } catch (error) {
    if (error instanceof DingTalkApiError) {
      console.error("DingTalk authentication failed", { code: error.code });
      return NextResponse.json({ error: "钉钉登录失败，请确认应用权限和服务端配置" }, { status: 502 });
    }
    console.error("DingTalk session creation failed", error);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}
