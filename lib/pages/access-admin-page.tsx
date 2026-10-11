import { notFound } from "next/navigation";

import { DingTalkAuth } from "@/components/dingtalk-auth";
import { EditorPolicyPanel } from "@/components/editor-policy-panel";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser, toPublicUser } from "@/lib/auth";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { getEditorAccessPolicy } from "@/lib/editor-policy";
import { classBasePath } from "@/lib/schedule/classes";

/**
 * Editor job-title policy. Deliberately company-wide: which job titles may edit
 * a timetable is an organizational decision, while *which* class somebody edits
 * is a membership (`ClassMember`).
 */
export async function AccessAdminPage({ classId }: { classId: string }) {
  const basePath = classBasePath(classId);
  const user = await getCurrentUser();
  if (!user) {
    return <DingTalkAuth {...getDingTalkPublicConfig()} basePath={basePath} returnTo="/admin/access" />;
  }
  if (!user.isSuperAdmin) notFound();

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-brand-mark">A</span>
          <div><strong>课程表权限</strong><small>管理员设置</small></div>
        </div>
        <UserMenu user={toPublicUser(user)} basePath={basePath} showEditorLink showViewerLink showClassAdminLink />
      </header>
      <div className="admin-content">
        <div className="admin-intro">
          <p className="section-kicker">ADMINISTRATION</p>
          <h1>编辑权限</h1>
          <p>配置哪些钉钉职位可以编辑课程表。权限保存后立即应用到新的请求；具体能编辑哪个班级由「班级管理」里的成员分配决定。</p>
        </div>
        <EditorPolicyPanel initialPolicy={await getEditorAccessPolicy()} />
      </div>
    </main>
  );
}
