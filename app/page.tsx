import { ScheduleViewer } from "@/components/schedule-viewer";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { getPublishedConfig } from "@/lib/schedule/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let config;
  try {
    config = await getPublishedConfig();
  } catch (error) {
    console.error("Published schedule page failed", error);
    return (
      <main className="editor-error-state">
        <h1>课表暂时无法打开</h1>
        <p>请稍后刷新页面，或联系管理员检查数据库连接。</p>
      </main>
    );
  }
  return <ScheduleViewer config={config} auth={getDingTalkPublicConfig()} />;
}

