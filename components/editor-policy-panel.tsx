"use client";

import { Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { EditorAccessPolicyView } from "@/lib/editor-policy";

export function EditorPolicyPanel({ initialPolicy }: { initialPolicy: EditorAccessPolicyView }) {
  const [titles, setTitles] = useState(initialPolicy.editorTitles);
  const [newTitle, setNewTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  function addTitle() {
    const title = newTitle.trim();
    if (!title) return;
    if (titles.includes(title)) {
      setMessage("这个职位已经在列表中");
      setStatus("error");
      return;
    }
    setTitles((current) => [...current, title]);
    setNewTitle("");
    setStatus("idle");
    setMessage("");
  }

  function removeTitle(title: string) {
    setTitles((current) => current.filter((item) => item !== title));
    setStatus("idle");
    setMessage("");
  }

  async function save() {
    if (status === "saving") return;
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/admin/editor-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ editorTitles: titles }),
      });
      const data = await response.json().catch(() => ({})) as EditorAccessPolicyView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "保存失败");
      setTitles(data.editorTitles ?? titles);
      setStatus("saved");
      setMessage("编辑职位设置已保存");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试");
    }
  }

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 2600);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <section className="policy-panel" aria-live="polite">
      <div className="policy-panel-heading">
        <div className="policy-panel-title">
          <span className="policy-panel-mark"><ShieldCheck size={18} /></span>
          <div>
            <p className="section-kicker">EDITOR ACCESS</p>
            <h2>可编辑职位</h2>
          </div>
        </div>
        <span className="policy-count">{titles.length} 个职位</span>
      </div>
      <p className="policy-help">职位匹配钉钉用户详情中的 title。企业管理员、老板和高管始终拥有编辑及权限设置权限。</p>
      <div className="policy-title-list" role="list" aria-label="可编辑职位列表">
        {titles.length ? titles.map((title) => (
          <div className="policy-title-row" role="listitem" key={title}>
            <span>{title}</span>
            <button className="icon-button icon-button-subtle" type="button" aria-label={`删除职位 ${title}`} title={`删除职位 ${title}`} onClick={() => removeTitle(title)}>
              <Trash2 size={15} />
            </button>
          </div>
        )) : <p className="policy-empty">暂未配置职位，只有组织管理员可以编辑。</p>}
      </div>
      <div className="policy-add-row">
        <label htmlFor="new-editor-title">添加职位</label>
        <div className="policy-add-controls">
          <input id="new-editor-title" value={newTitle} maxLength={80} placeholder="例如：年级主任" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTitle(); } }} />
          <button className="icon-button icon-button-accent" type="button" aria-label="添加职位" title="添加职位" onClick={addTitle}><Plus size={16} /></button>
        </div>
      </div>
      {message ? <p className={`policy-message policy-message-${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
      <div className="policy-footer">
        <span>{initialPolicy.updatedBy ? `最近由 ${initialPolicy.updatedBy.name} 更新` : "首次初始化为默认职位"}</span>
        <button className="primary-button" type="button" onClick={() => void save()} disabled={status === "saving"}>
          {status === "saving" ? <RefreshCw className="toolbar-spinner" size={15} /> : <Save size={15} />}
          {status === "saving" ? "保存中" : "保存设置"}
        </button>
      </div>
    </section>
  );
}
