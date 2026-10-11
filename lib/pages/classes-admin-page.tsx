import { notFound } from "next/navigation";

import { ClassAdminPanel } from "@/components/class-admin-panel";
import { DingTalkAuth } from "@/components/dingtalk-auth";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser, toPublicUser } from "@/lib/auth";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { classBasePath } from "@/lib/schedule/classes";

/** Super-admin page for creating classes and assigning their members. */
export async function ClassesAdminPage({ classId }: { classId: string }) {
  const basePath = classBasePath(classId);
  const user = await getCurrentUser();
  if (!user) {
    return <DingTalkAuth {...getDingTalkPublicConfig()} basePath={basePath} returnTo="/admin/classes" />;
  }
  if (!user.isSuperAdmin) notFound();

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-brand-mark">A</span>
          <div><strong>班级管理</strong><small>管理员设置</small></div>
        </div>
        <UserMenu user={toPublicUser(user)} basePath={basePath} showEditorLink showViewerLink showAdminLink />
      </header>
      <div className="admin-content">
        <div className="admin-intro">
          <p className="section-kicker">ADMINISTRATION</p>
          <h1>班级与成员</h1>
          <p>每个班级拥有独立的课表、草稿、临时调课与历史快照。标识同时是访问路径与客户端地址的一部分。</p>
        </div>
        <ClassAdminPanel basePath={basePath} currentClassId={classId} />
      </div>
    </main>
  );
}
