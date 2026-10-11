import { resolveDefaultClassId } from "@/lib/api/class-route";
import { SchedulePage } from "@/lib/pages/schedule-page";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const classId = await resolveDefaultClassId();
  return <SchedulePage classId={classId} />;
}
