export function isEditorEnabled(): boolean {
  const configured = process.env.EDITOR_ENABLED;
  if (configured === undefined) return process.env.NODE_ENV !== "production";
  return configured.toLowerCase() === "true";
}
