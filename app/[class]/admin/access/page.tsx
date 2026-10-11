import { resolveSegmentClassId } from "@/lib/api/class-route";
import { AccessAdminPage } from "@/lib/pages/access-admin-page";

export const dynamic = "force-dynamic";

export default async function ClassEditorAccessPage({ params }: PageProps<"/[class]/admin/access">) {
  const { class: classSegment } = await params;
  const classId = await resolveSegmentClassId(classSegment);
  return <AccessAdminPage classId={classId} />;
}
