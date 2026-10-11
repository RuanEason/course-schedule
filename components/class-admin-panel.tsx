"use client";

import { Check, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { isValidClassSlug } from "@/lib/schedule/classes";

interface ClassRow {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

interface MemberRow {
  userId: string;
  name: string;
  userIdInCorp: string;
  title: string | null;
}

interface ClassAdminPanelProps {
  basePath?: string;
  currentClassId: string;
}

/**
 * Create classes and assign teachers to them.
 *
 * Classes are addressed by slug (`class2`), which is also the URL prefix and the
 * database partition key, so the id is immutable once created — only the display
 * name and membership change afterwards.
 */
export function ClassAdminPanel({ basePath = "", currentClassId }: ClassAdminPanelProps) {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selected, setSelected] = useState(currentClassId);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("loading");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /**
   * Loads the class list.
   *
   * State is only ever written from `applyClasses`, called after the fetch
   * settles, so this stays a plain async function with no synchronous setState
   * for the mount effect to trip over.
   */
  const loadClasses = useCallback(async () => {
    try {
      const response = await fetch(`${basePath}/api/admin/classes`, { cache: "no-store", credentials: "same-origin" });
      const data = await response.json().catch(() => null) as { all?: ClassRow[]; classes?: ClassRow[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "无法读取班级列表");
      return { rows: data?.all ?? data?.classes ?? [], error: "" };
    } catch (caught) {
      return { rows: null, error: caught instanceof Error ? caught.message : "无法读取班级列表" };
    }
  }, [basePath]);

  useEffect(() => {
    let cancelled = false;
    void loadClasses().then((result) => {
      if (cancelled) return;
      if (result.rows) {
        setClasses(result.rows);
        setSelected((current) =>
          result.rows!.length && !result.rows!.some((row) => row.id === current) ? result.rows![0].id : current,
        );
      }
      setError(result.error);
      setStatus("idle");
    });
    return () => { cancelled = true; };
  }, [loadClasses]);

  /** Button-triggered refresh; sets the loading flag the effect must not. */
  async function refreshClasses() {
    setStatus("loading");
    const result = await loadClasses();
    if (result.rows) {
      setClasses(result.rows);
      setSelected((current) =>
        result.rows!.length && !result.rows!.some((row) => row.id === current) ? result.rows![0].id : current,
      );
    }
    setError(result.error);
    setStatus("idle");
  }

  useEffect(() => {
    let cancelled = false;
    async function loadMembers() {
      const response = await fetch(`${basePath}/api/admin/classes/${selected}`, { cache: "no-store", credentials: "same-origin" }).catch(() => null);
      if (!response?.ok || cancelled) return;
      const data = await response.json().catch(() => null) as { members?: MemberRow[] } | null;
      if (!cancelled) setMembers(data?.members ?? []);
    }
    void loadMembers();
    return () => { cancelled = true; };
  }, [basePath, selected]);

  async function createClass() {
    setError("");
    setMessage("");
    const id = newId.trim();
    const name = newName.trim() || id;
    if (!isValidClassSlug(id)) {
      setError("班级标识必须形如 class2（class + 数字开头，如 class2、class12）");
      return;
    }
    setStatus("saving");
    try {
      const response = await fetch(`${basePath}/api/admin/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id, name }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "创建班级失败");
      setNewId("");
      setNewName("");
      setMessage(`已创建 ${name}，入口地址为 ${basePath}/${id}`);
      await refreshClasses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建班级失败");
    } finally {
      setStatus("idle");
    }
  }

  async function saveName(id: string, name: string) {
    setStatus("saving");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${basePath}/api/admin/classes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error("更新班级名称失败");
      setMessage(`已更新 ${name}`);
      await refreshClasses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新班级名称失败");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div className="class-admin">
      <section className="class-admin-create">
        <h2>新增班级</h2>
        <div className="class-admin-form">
          <label>
            <span>班级标识</span>
            <input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="class2" />
          </label>
          <label>
            <span>显示名称</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="2 班" />
          </label>
          <button className="primary-button" type="button" onClick={() => void createClass()} disabled={status === "saving"}>
            {status === "saving" ? <RefreshCw className="auth-spinner" size={15} /> : <Plus size={15} />}
            创建
          </button>
        </div>
        <p className="class-admin-hint">
          标识决定访问地址与数据分区，创建后不可修改。例如标识 <code>class2</code> 对应
          <code>{basePath || ""}/class2</code> 与客户端地址 <code>{basePath || ""}/class2/config.json</code>。
        </p>
      </section>

      {error ? <div className="class-admin-error" role="alert">{error}</div> : null}
      {message ? <div className="class-admin-message">{message}</div> : null}

      <section className="class-admin-list">
        <div className="class-admin-list-heading">
          <h2>班级列表</h2>
          <button type="button" className="secondary-button" onClick={() => void refreshClasses()} disabled={status === "loading"}>
            <RefreshCw size={14} />刷新
          </button>
        </div>
        <div className="class-admin-rows">
          {classes.map((row) => (
            <div className={`class-admin-row${row.id === selected ? " is-selected" : ""}`} key={row.id}>
              <button type="button" className="class-admin-row-pick" onClick={() => setSelected(row.id)}>
                <strong>{row.name}</strong>
                <span>{row.id}</span>
                {row.id === selected ? <Check size={14} /> : null}
              </button>
              <NameEditor key={`${row.id}:${row.name}`} initial={row.name} onSave={(name) => void saveName(row.id, name)} />
              <a className="user-menu-link" href={`${basePath}/${row.id}`}>打开</a>
              <a className="user-menu-link" href={`${basePath}/${row.id}/config.json`}>配置地址</a>
            </div>
          ))}
          {classes.length === 0 && status === "idle" ? <p className="class-admin-hint">暂无班级。</p> : null}
        </div>
      </section>

      <section className="class-admin-members">
        <h2>{classes.find((row) => row.id === selected)?.name ?? selected} · 成员</h2>
        <p className="class-admin-hint">只有列表中的老师（以及钉钉主管理员）可以编辑该班级的课表。</p>
        <MemberPicker basePath={basePath} classId={selected} members={members} onSaved={setMembers} />
      </section>
    </div>
  );
}

/**
 * Renames a class. The parent keys this component by class id, so switching
 * rows remounts it with the right initial value instead of syncing via an
 * effect.
 */
function NameEditor({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="class-admin-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && value.trim() !== initial) onSave(value.trim());
      }}
    >
      <input aria-label="班级显示名称" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" disabled={value.trim() === initial || !value.trim()}>保存</button>
    </form>
  );
}

function MemberPicker({
  basePath,
  classId,
  members,
  onSaved,
}: {
  basePath: string;
  classId: string;
  members: MemberRow[];
  onSaved: (members: MemberRow[]) => void;
}) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(next: MemberRow[]) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${basePath}/api/admin/classes/${classId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userIds: next.map((member) => member.userId) }),
      });
      const data = await response.json().catch(() => null) as { members?: MemberRow[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "保存班级成员失败");
      onSaved(data?.members ?? next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存班级成员失败");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Members are added by DingTalk user id. They have to have signed in at least
   * once for the id to exist locally, so the field documents that requirement
   * rather than pretending to look anybody up.
   */
  function addById() {
    const id = input.trim();
    if (!id) return;
    if (members.some((member) => member.userId === id)) {
      setInput("");
      return;
    }
    setInput("");
    void save([...members, { userId: id, name: id, userIdInCorp: id, title: null }]);
  }

  return (
    <div className="class-admin-member-picker">
      <ul className="class-admin-member-list">
        {members.map((member) => (
          <li key={member.userId}>
            <div>
              <strong>{member.name}</strong>
              <span>{member.title || "未设置职位"}</span>
            </div>
            <button type="button" disabled={saving} onClick={() => void save(members.filter((item) => item.userId !== member.userId))}>
              移除
            </button>
          </li>
        ))}
        {members.length === 0 ? <li className="class-admin-hint">尚未分配成员。</li> : null}
      </ul>
      <div className="class-admin-form">
        <label>
          <span>钉钉用户 ID</span>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="登录过本系统的 userid" />
        </label>
        <button className="primary-button" type="button" onClick={addById} disabled={saving || !input.trim()}>
          <Plus size={15} />添加
        </button>
      </div>
      {error ? <div className="class-admin-error" role="alert">{error}</div> : null}
    </div>
  );
}
