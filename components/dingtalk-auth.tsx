"use client";

import { AlertTriangle, LogIn, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface DingTalkAuthProps {
  clientId: string;
  corpId: string;
  returnTo?: string;
}

function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function DingTalkAuth({ clientId, corpId, returnTo = "/" }: DingTalkAuthProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const attemptedRef = useRef(false);
  const target = safeReturnTo(returnTo);

  const beginLogin = useCallback(async () => {
    if (!clientId || !corpId) {
      setStatus("error");
      setMessage("钉钉应用配置尚未完成，请联系管理员");
      return;
    }

    setStatus("loading");
    setMessage("");
    try {
      const { default: dd } = await import("dingtalk-jsapi");
      const result = await dd.requestAuthCode({ corpId, clientId });
      const response = await fetch("/api/auth/dingtalk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ code: result.code }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "钉钉登录失败");
      window.location.replace(target);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error && error.message
        ? error.message
        : "请在钉钉工作台内打开此应用后重试");
    }
  }, [clientId, corpId, target]);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;
    // The first request gives users an automatic DingTalk SSO experience.
    void beginLogin();
  }, [beginLogin]);

  return (
    <main className="auth-gate">
      <section className="auth-card" aria-live="polite">
        <div className="auth-card-mark"><ShieldCheck size={24} /></div>
        <p className="section-kicker">DINGTALK ACCESS</p>
        <h1>正在验证钉钉身份</h1>
        <p className="auth-card-copy">
          {status === "loading" ? "请稍候，正在读取当前钉钉用户。" : message || "请在钉钉工作台中打开此应用。"}
        </p>
        {status === "loading" ? <RefreshCw className="auth-spinner" size={18} aria-label="验证中" /> : null}
        {status === "error" ? (
          <div className="auth-error" role="alert">
            <AlertTriangle size={16} />
            <span>{message}</span>
          </div>
        ) : null}
        <button className="primary-button auth-retry" type="button" onClick={() => void beginLogin()} disabled={status === "loading"}>
          {status === "loading" ? <RefreshCw className="auth-spinner" size={16} /> : <LogIn size={16} />}
          {status === "loading" ? "验证中" : "重新验证"}
        </button>
      </section>
    </main>
  );
}
