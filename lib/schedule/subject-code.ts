export type SubjectEntryMode = "simple" | "composite";

export interface SubjectCodeParts {
  mode: SubjectEntryMode;
  primary: string;
  secondary: string;
}

export interface SubjectCodeFieldErrors {
  primary?: string;
  secondary?: string;
}

export function parseSubjectCode(code: string): SubjectCodeParts {
  const [primary = "", ...rest] = code.split("@");
  return {
    mode: rest.length ? "composite" : "simple",
    primary,
    secondary: rest.join("@"),
  };
}

export function composeSubjectCode(mode: SubjectEntryMode, primary: string, secondary = ""): string {
  const normalizedPrimary = primary.trim();
  if (mode === "simple") return normalizedPrimary;
  return `${normalizedPrimary}@${secondary.trim()}`;
}

export function validateSubjectCodeFields(
  mode: SubjectEntryMode,
  primary: string,
  secondary = "",
): SubjectCodeFieldErrors {
  const errors: SubjectCodeFieldErrors = {};
  const normalizedPrimary = primary.trim();
  const normalizedSecondary = secondary.trim();

  if (!normalizedPrimary) {
    errors.primary = mode === "composite" ? "请输入 @ 左侧代码" : "请输入课程简称";
  } else if (normalizedPrimary.includes("@")) {
    errors.primary = "这里不要输入 @";
  }

  if (mode === "composite") {
    if (!normalizedSecondary) {
      errors.secondary = "请输入 @ 右侧代码";
    } else if (normalizedSecondary.includes("@")) {
      errors.secondary = "这里不要输入 @";
    }
  }

  return errors;
}
