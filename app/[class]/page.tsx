import { resolveSegmentClassId } from "@/lib/api/class-route";
import { SchedulePage } from "@/lib/pages/schedule-page";

export const dynamic = "force-dynamic";

export default async function ClassHomePage({ params }: PageProps<"/[class]">) {
  const { class: classSegment } = await params;
  const classId = await resolveSegmentClassId(classSegment);
  return <SchedulePage classId={classId} />;
}
