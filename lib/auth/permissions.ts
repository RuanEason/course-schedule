export const DEFAULT_EDITOR_TITLES = ["班主任", "主管理员"] as const;

export interface PermissionProfile {
  title?: unknown;
  isAdmin: unknown;
  isBoss: unknown;
  isSenior: unknown;
}

export function normalizeTitle(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEditorTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((title) => normalizeTitle(title))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function isDingTalkBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes"].includes(value.trim().toLowerCase());
}

export function isSuperAdmin(profile: PermissionProfile): boolean {
  return isDingTalkBoolean(profile.isAdmin)
    || isDingTalkBoolean(profile.isBoss)
    || isDingTalkBoolean(profile.isSenior);
}

export function hasEditorTitle(title: unknown, editorTitles: readonly string[]): boolean {
  const normalizedTitle = normalizeTitle(title);
  return Boolean(normalizedTitle) && normalizeEditorTitles(editorTitles).includes(normalizedTitle);
}

export function canEditSchedule(profile: PermissionProfile, editorTitles: readonly string[]): boolean {
  return isSuperAdmin(profile) || hasEditorTitle(profile.title, editorTitles);
}
