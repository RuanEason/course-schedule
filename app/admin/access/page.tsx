import { resolveDefaultClassId } from "@/lib/api/class-route";
import { AccessAdminPage } from "@/lib/pages/access-admin-page";

export const dynamic = "force-dynamic";

export default async function EditorAccessPage() {
  const classId = await resolveDefaultClassId();
  return <AccessAdminPage classId={classId} />;
}
