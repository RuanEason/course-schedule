import { ScheduleViewer } from "@/components/schedule-viewer";
import { getDingTalkPublicConfig } from "@/lib/dingtalk";
import { getScheduleToday } from "@/lib/schedule/adjustment";
import { getClass } from "@/lib/schedule/class-context";
import { classBasePath } from "@/lib/schedule/classes";
import { getPublishedConfig } from "@/lib/schedule/repository";

/**
 * Published-schedule page body, shared by `/` and `/classN`.
 *
 * `classId` is passed in rather than read from the request so the two entry
 * points cannot disagree about which class they are rendering.
 *
 * The current user is deliberately NOT resolved here: the viewer authenticates
 * in the browser (see `ViewerAuth`), which is what keeps the published schedule
 * renderable — and cacheable — without a session, and preserves the
 * "verifying identity" state the UI is built around.
 */
export async function SchedulePage({ classId }: { classId: string }) {
  const today = getScheduleToday();
  const basePath = classBasePath(classId);

  let config;
  let className: string | null = null;
  try {
    config = await getPublishedConfig(classId, today);
    className = (await getClass(classId))?.name ?? null;
  } catch (error) {
    console.error("Published schedule page failed", error);
    return (
      <main className="editor-error-state">
        <h1>课表暂时无法打开</h1>
        <p>请稍后刷新页面，或联系管理员检查数据库连接。</p>
      </main>
    );
  }

  return (
    <ScheduleViewer
      config={config}
      auth={getDingTalkPublicConfig()}
      today={today}
      basePath={basePath}
      classId={classId}
      className={className}
      publishedAt={null}
    />
  );
}
