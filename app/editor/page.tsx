import { resolveDefaultClassId } from "@/lib/api/class-route";
import { EditorPage } from "@/lib/pages/editor-page";

export const dynamic = "force-dynamic";

export default async function EditorRoute() {
  const classId = await resolveDefaultClassId();
  return <EditorPage classId={classId} />;
}
