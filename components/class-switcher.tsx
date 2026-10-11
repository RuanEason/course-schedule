"use client";

import { ChevronDown, LayoutGrid } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { PublicUser } from "@/lib/auth";

interface ClassSummary {
  id: string;
  name: string;
}

interface ClassSwitcherProps {
  user: PublicUser;
  /** Prefix of the page the switcher sits on, e.g. `/class2`. */
  basePath?: string;
  classId?: string;
}

const DEFAULT_CLASS_ID = "default";

/**
 * Switches the current class without touching the server session.
 *
 * The class lives in the URL, so switching is a navigation. Only users with
 * more than one editable class see the control; everybody else would be offered
 * links that answer 403.
 */
export function ClassSwitcher({ user, basePath = "", classId }: ClassSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const unrestricted = user.editableClassIds.includes("*");
  const knownCount = unrestricted ? Number.POSITIVE_INFINITY : user.editableClassIds.length;
  const currentClassId = classId ?? (basePath ? basePath.replace(/^\//, "") : DEFAULT_CLASS_ID);

  useEffect(() => {
    // Nothing to switch between: skip the request entirely.
    if (knownCount === 1) return;
    let cancelled = false;
    fetch(`${basePath}/api/admin/classes`, { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { classes?: ClassSummary[] } | null) => {
        if (cancelled) return;
        setClasses(data?.classes ?? []);
      })
      .catch(() => {
        if (!cancelled) setClasses([]);
      });
    return () => { cancelled = true; };
  }, [basePath, knownCount]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (knownCount === 1) return null;
  const options = classes ?? [];
  if (classes !== null && options.length <= 1) return null;

  const current = options.find((item) => item.id === currentClassId);
  const currentLabel = current?.name ?? (currentClassId === DEFAULT_CLASS_ID ? "1 班" : currentClassId);

  function select(targetId: string) {
    setOpen(false);
    if (targetId === currentClassId) return;
    // Preserve the sub-route (`/editor`, `/admin/classes`) so switching a class
    // does not throw the user back to the viewer.
    const subPath = basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : "";
    const nextBase = targetId === DEFAULT_CLASS_ID ? "" : `/${targetId}`;
    router.push(`${nextBase}${subPath}` || "/");
  }

  return (
    <div className="class-switcher" ref={containerRef}>
      <button
        className="class-switcher-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`当前班级：${currentLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span>{currentLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="class-switcher-options" role="listbox" aria-label="选择班级">
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === currentClassId}
              className={item.id === currentClassId ? "is-active" : ""}
              onClick={() => select(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
