import { resolveDefaultClassId } from "@/lib/api/class-route";
import { ClassesAdminPage } from "@/lib/pages/classes-admin-page";

export const dynamic = "force-dynamic";

export default async function ClassManagementPage() {
  const classId = await resolveDefaultClassId();
  return <ClassesAdminPage classId={classId} />;
}
