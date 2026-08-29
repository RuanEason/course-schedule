import { describe, expect, it } from "vitest";

import {
  canEditSchedule,
  DEFAULT_EDITOR_TITLES,
  hasEditorTitle,
  isDingTalkBoolean,
  isSuperAdmin,
  normalizeEditorTitles,
  normalizeTitle,
} from "@/lib/auth/permissions";
import {
  parseDingTalkIdentity,
  parseDingTalkProfile,
  resetDingTalkTokenCache,
} from "@/lib/dingtalk";

describe("DingTalk permissions", () => {
  it("normalizes and deduplicates configured titles", () => {
    expect(normalizeEditorTitles([" 班主任 ", "", "班主任", "年级主任"])).toEqual(["班主任", "年级主任"]);
    expect(normalizeTitle(" 主管理员 ")).toBe("主管理员");
  });

  it("accepts DingTalk boolean representations", () => {
    expect(isDingTalkBoolean(true)).toBe(true);
    expect(isDingTalkBoolean("true")).toBe(true);
    expect(isDingTalkBoolean("1")).toBe(true);
    expect(isDingTalkBoolean("false")).toBe(false);
  });

  it("treats admin, boss, and senior as super admins", () => {
    expect(isSuperAdmin({ title: "教师", isAdmin: true, isBoss: false, isSenior: false })).toBe(true);
    expect(isSuperAdmin({ title: "教师", isAdmin: false, isBoss: true, isSenior: false })).toBe(true);
    expect(isSuperAdmin({ title: "教师", isAdmin: false, isBoss: false, isSenior: true })).toBe(true);
    expect(isSuperAdmin({ title: "教师", isAdmin: false, isBoss: false, isSenior: false })).toBe(false);
  });

  it("matches editor titles exactly after trimming", () => {
    expect(hasEditorTitle(" 班主任 ", DEFAULT_EDITOR_TITLES)).toBe(true);
    expect(hasEditorTitle("副班主任", DEFAULT_EDITOR_TITLES)).toBe(false);
    expect(canEditSchedule({ title: "班主任", isAdmin: false, isBoss: false, isSenior: false }, DEFAULT_EDITOR_TITLES)).toBe(true);
    expect(canEditSchedule({ title: "教师", isAdmin: false, isBoss: false, isSenior: false }, DEFAULT_EDITOR_TITLES)).toBe(false);
  });
});

describe("DingTalk response parsing", () => {
  it("extracts identity from the userinfo response", () => {
    expect(parseDingTalkIdentity({
      errcode: 0,
      result: { userid: "user-1", unionid: "union-1" },
    })).toEqual({ userId: "user-1", unionId: "union-1" });
  });

  it("extracts title and organization flags from user details", () => {
    expect(parseDingTalkProfile({
      errcode: 0,
      result: {
        userid: "user-1",
        unionid: "union-1",
        name: "张三",
        title: "班主任",
        avatar: "https://example.com/avatar.png",
        admin: "true",
        boss: "false",
        senior: false,
      },
    }, { userId: "user-1", unionId: "union-1" }, "corp-1")).toEqual({
      corpId: "corp-1",
      userId: "user-1",
      unionId: "union-1",
      name: "张三",
      title: "班主任",
      avatarUrl: "https://example.com/avatar.png",
      isAdmin: true,
      isBoss: false,
      isSenior: false,
    });
  });

  it("rejects responses without stable identity fields", () => {
    expect(() => parseDingTalkIdentity({ errcode: 0, result: {} })).toThrow("缺少必要标识");
  });

  it("exposes a reset hook for isolated token tests", () => {
    expect(() => resetDingTalkTokenCache()).not.toThrow();
  });
});
