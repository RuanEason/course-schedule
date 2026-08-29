"use client";

import Link from "next/link";
import { Eye, Pencil, Settings2, UserRound } from "lucide-react";
import { useRef, useState } from "react";

import type { PublicUser } from "@/lib/auth";

interface UserMenuProps {
  user: PublicUser;
  showEditorLink?: boolean;
  showAdminLink?: boolean;
  showViewerLink?: boolean;
}

export function UserMenu({ user, showEditorLink = false, showAdminLink = false, showViewerLink = false }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }

  function openMenu(immediate = false) {
    clearTimers();
    if (immediate) {
      setIsOpen(true);
      return;
    }
    openTimerRef.current = setTimeout(() => setIsOpen(true), 240);
  }

  function closeMenu() {
    clearTimers();
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 160);
  }

  return (
    <div className={`user-menu${isOpen ? " is-open" : ""}`} onMouseEnter={() => openMenu()} onMouseLeave={closeMenu} onFocus={() => openMenu(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
      <button className="user-avatar-button" type="button" aria-label="当前用户头像" aria-expanded={isOpen} aria-controls="user-menu-popover" onClick={() => openMenu(true)}>
        {user.avatarUrl ? <span className="user-avatar user-avatar-image" aria-hidden="true" style={{ backgroundImage: `url(${user.avatarUrl})` }} /> : <span className="user-avatar user-avatar-fallback" aria-hidden="true"><UserRound size={16} /></span>}
      </button>
      <div className="user-menu-popover" id="user-menu-popover" role="dialog" aria-label="用户操作">
        {showViewerLink ? <Link className="user-menu-link" href="/"><Eye size={15} />返回预览视角</Link> : null}
        {showEditorLink && user.canEdit ? <Link className="user-menu-link" href="/editor"><Pencil size={15} />编辑课表</Link> : null}
        {showAdminLink && user.isSuperAdmin ? <Link className="user-menu-link" href="/admin/access"><Settings2 size={15} />权限设置</Link> : null}
      </div>
    </div>
  );
}
