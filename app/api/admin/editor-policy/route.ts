import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authErrorResponse,
  isMockUser,
  requireSuperAdmin,
  sameOriginError,
} from "@/lib/auth";
import { getEditorAccessPolicy, updateEditorAccessPolicy } from "@/lib/editor-policy";

export const dynamic = "force-dynamic";

const policySchema = z.object({
  editorTitles: z.array(z.string().trim().min(1).max(80)).max(50),
});

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json(await getEditorAccessPolicy());
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor policy lookup failed", error);
    return NextResponse.json({ error: "暂时无法读取编辑权限设置" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  try {
    const user = await requireSuperAdmin();
    const body = await request.json().catch(() => null);
    const result = policySchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({
        error: "职位列表格式无效",
        issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, { status: 422 });
    }

    const policy = await updateEditorAccessPolicy(result.data.editorTitles, isMockUser(user) ? null : user.id);
    return NextResponse.json(policy);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Editor policy update failed", error);
    return NextResponse.json({ error: "保存编辑权限设置失败" }, { status: 500 });
  }
}
