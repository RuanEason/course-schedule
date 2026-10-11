import { resolveSegmentClassId } from "@/lib/api/class-route";
import { ClassesAdminPage } from "@/lib/pages/classes-admin-page";

export const dynamic = "force-dynamic";

export default async function ClassManagementPage({ params }: PageProps<"/[class]/admin/classes">) {
  const { class: classSegment } = await params;
  const classId = await resolveSegmentClassId(classSegment);
  return <ClassesAdminPage classId={classId} />;
}
