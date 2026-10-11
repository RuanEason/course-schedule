import { resolveSegmentClassId } from "@/lib/api/class-route";
import { EditorPage } from "@/lib/pages/editor-page";

export const dynamic = "force-dynamic";

export default async function ClassEditorPage({ params }: PageProps<"/[class]/editor">) {
  const { class: classSegment } = await params;
  const classId = await resolveSegmentClassId(classSegment);
  return <EditorPage classId={classId} />;
}
