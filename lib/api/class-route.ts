import "server-only";

import { notFound } from "next/navigation";

import { getRequestClassId } from "@/lib/schedule/class-context";
import { classIsAddressable } from "@/lib/api/handlers";
import { DEFAULT_CLASS_ID } from "@/lib/schedule/classes";

/**
 * Resolve the class for a `app/[class]/**` route segment.
 *
 * `proxy.ts` only rewrites paths whose segment looks like a class slug, so
 * reaching here with anything else means a caller typed a URL such as
 * `/classroom`; that is a 404, not a fallback to a real class.
 */
export async function resolveSegmentClassId(segment: string): Promise<string> {
  if (!(await classIsAddressable(segment))) notFound();
  return segment;
}

/** The class for an unprefixed route (the historical, default-class entry point). */
export async function resolveDefaultClassId(): Promise<string> {
  const classId = await getRequestClassId();
  if (!(await classIsAddressable(classId))) notFound();
  return classId;
}

export { DEFAULT_CLASS_ID };
