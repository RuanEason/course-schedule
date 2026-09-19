"use client";

import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import type { PublicUser } from "@/lib/auth";
import { isDingTalkContainer } from "@/lib/dingtalk-env";
import { UserMenu } from "@/components/user-menu";

type AuthStatus = "checking" | "authenticated" | "anonymous";

type MeResponse = { user?: PublicUser };

interface ViewerAuthProps {
  corpId?: string;
  clientId?: string;
}

const AUTH_TIMEOUT_MS = 10_000;
const HIDE_ANIMATION_MS = 200;

/**
 * Deduplicates concurrent auth flows so React StrictMode remounts (and any
 * accidental double mount) share a single request instead of racing.
 */
let pendingAuth: Promise<PublicUser | null> | null = null;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("鉴权超时")), AUTH_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchCurrentUser(): Promise<PublicUser | null> {
  const response = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("无法读取当前用户");

  const data = await response.json().catch(() => null) as MeResponse | null;
  return data?.user ?? null;
}

async function createDingTalkSession(corpId: string, clientId: string): Promise<PublicUser | null> {
  const { default: dd } = await import("dingtalk-jsapi");
  if (!isDingTalkContainer(dd.env?.platform)) return null;
  if (!corpId || !clientId) throw new Error("钉钉应用配置缺失");

  const result = await withTimeout(dd.requestAuthCode({ corpId, clientId }));
  const response = await withTimeout(fetch("/api/auth/dingtalk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ code: result.code }),
  }));
  if (!response.ok) throw new Error("钉钉登录失败");

  const data = await response.json().catch(() => null) as MeResponse | null;
  if (!data?.user) throw new Error("钉钉登录失败");
  return data.user;
}

function resolveUser(corpId: string, clientId: string): Promise<PublicUser | null> {
  if (!pendingAuth) {
    pendingAuth = (async () => {
      const existing = await fetchCurrentUser();
      if (existing) return existing;
      return createDingTalkSession(corpId, clientId);
    })().finally(() => { pendingAuth = null; });
  }
  return pendingAuth;
}

export function ViewerAuth({ corpId = "", clientId = "" }: ViewerAuthProps) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    resolveUser(corpId, clientId).then(
      (resolved) => {
        if (cancelled) return;
        if (resolved) {
          setUser(resolved);
          setStatus("authenticated");
          return;
        }
        setIsLeaving(true);
        hideTimer = setTimeout(() => { if (!cancelled) setStatus("anonymous"); }, HIDE_ANIMATION_MS);
      },
      () => {
        // Failures stay silent: the schedule stays public and the avatar retracts.
        if (cancelled) return;
        setIsLeaving(true);
        hideTimer = setTimeout(() => { if (!cancelled) setStatus("anonymous"); }, HIDE_ANIMATION_MS);
      },
    );

    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [clientId, corpId]);

  if (status === "anonymous") return null;

  if (status === "authenticated" && user) {
    return (
      <div className="viewer-auth">
        <UserMenu user={user} showEditorLink showAdminLink />
      </div>
    );
  }

  return (
    <div className={`viewer-auth${isLeaving ? " is-leaving" : ""}`}>
      <button className="viewer-auth-trigger" type="button" aria-label="正在验证身份" title="正在验证身份" disabled>
        <UserRound className="viewer-auth-spinner" size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

