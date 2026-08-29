"use client";

import Link from "next/link";
import { Eye, Pencil, Settings2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PublicUser } from "@/lib/auth";

interface PresenceUser {
  userId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  lastSeenAt?: string;
}

function toPresenceUser(user: PublicUser): PresenceUser {
  return {
    userId: user.userId,
    name: user.name,
    title: user.title,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
  };
}

function mergeUsers(currentUser: PublicUser, onlineUsers: PresenceUser[]): PresenceUser[] {
  const users = new Map<string, PresenceUser>();
  users.set(currentUser.userId, toPresenceUser(currentUser));
  for (const user of onlineUsers) users.set(user.userId, user);
  return [...users.values()];
}

function avatarLabel(user: PresenceUser): string {
  return user.name.trim().slice(0, 1) || "钉";
}

function Avatar({ user, className = "" }: { user: PresenceUser; className?: string }) {
  return user.avatarUrl ? (
    <span className={`presence-avatar ${className}`} aria-hidden="true" style={{ backgroundImage: `url("${user.avatarUrl}")` }} />
  ) : (
    <span className={`presence-avatar presence-avatar-fallback ${className}`} aria-hidden="true">{avatarLabel(user)}</span>
  );
}

export function EditorPresence({ user }: { user: PublicUser }) {
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>(() => [toPresenceUser(user)]);
  const [isOpen, setIsOpen] = useState(false);
  const presenceIdRef = useRef<string | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }

  function openCard(immediate = false) {
    clearTimers();
    if (immediate) {
      setIsOpen(true);
      return;
    }
    openTimerRef.current = setTimeout(() => setIsOpen(true), 260);
  }

  function closeCard() {
    clearTimers();
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 180);
  }

  useEffect(() => {
    let mounted = true;
    const presenceId = presenceIdRef.current ?? (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    presenceIdRef.current = presenceId;

    async function heartbeat() {
      await fetch("/api/editor/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ presenceId }),
      }).catch(() => undefined);
    }

    async function refresh() {
      const response = await fetch("/api/editor/presence", { cache: "no-store", credentials: "same-origin" }).catch(() => null);
      if (!response?.ok) return;
      const data = await response.json().catch(() => null) as { users?: PresenceUser[] } | null;
      if (mounted && data?.users) setOnlineUsers(mergeUsers(user, data.users));
    }

    void heartbeat();
    void refresh();
    const heartbeatTimer = setInterval(() => void heartbeat(), 15_000);
    const refreshTimer = setInterval(() => void refresh(), 10_000);
    return () => {
      mounted = false;
      clearInterval(heartbeatTimer);
      clearInterval(refreshTimer);
      clearTimers();
      void fetch("/api/editor/presence", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ presenceId }),
      }).catch(() => undefined);
    };
  }, [user]);

  const visibleUsers = onlineUsers.slice(0, 4);
  const extraCount = Math.max(0, onlineUsers.length - visibleUsers.length);

  return (
    <div
      className={`editor-presence${isOpen ? " is-open" : ""}`}
      onMouseEnter={() => openCard()}
      onMouseLeave={closeCard}
      onFocus={() => openCard(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <button className="presence-trigger" type="button" aria-label={`${onlineUsers.length} 人正在编辑`} aria-expanded={isOpen} aria-controls="editor-presence-card" onClick={() => openCard(true)}>
        <span className="presence-avatar-stack" aria-hidden="true">
          {visibleUsers.map((onlineUser) => <Avatar key={onlineUser.userId} user={onlineUser} className="presence-avatar-stack-item" />)}
          {extraCount ? <span className="presence-avatar presence-avatar-more">+{extraCount}</span> : null}
        </span>
      </button>
      <section className="editor-presence-card" id="editor-presence-card" role="dialog" aria-label="正在编辑的人员">
        <div className="presence-card-heading">
          <div><strong>正在编辑</strong><span>{onlineUsers.length} 人在线</span></div>
          <Users size={16} aria-hidden="true" />
        </div>
        <div className="presence-user-list">
          {onlineUsers.map((onlineUser) => (
            <div className="presence-user-row" key={onlineUser.userId}>
              <Avatar user={onlineUser} />
              <div><strong>{onlineUser.name}{onlineUser.userId === user.userId ? "（你）" : ""}</strong><span>{onlineUser.title || "未设置职位"}</span></div>
            </div>
          ))}
        </div>
        {user.isSuperAdmin ? (
          <div className="presence-card-footer">
            <Link className="user-menu-link" href="/"><Eye size={15} />返回预览视角</Link>
            <Link className="user-menu-link" href="/admin/access"><Settings2 size={15} />权限设置</Link>
          </div>
        ) : (
          <div className="presence-card-footer">
            <Link className="user-menu-link" href="/"><Eye size={15} />返回预览视角</Link>
          </div>
        )}
        {user.canEdit ? <span className="presence-card-hint"><Pencil size={12} />编辑状态每 15 秒更新</span> : null}
      </section>
    </div>
  );
}
