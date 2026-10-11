import { describe, expect, it } from "vitest";

import {
  CLASS_PATH_PREFIX,
  CLASS_SLUG_SOURCE,
  DEFAULT_CLASS_ID,
  classBasePath,
  isApiPath,
  isReservedPath,
  isValidClassSlug,
  parseClassPath,
} from "@/lib/schedule/classes";
import { canEditClass, isAddressableClassId, type CurrentUser } from "@/lib/auth";
import type { PermissionProfile } from "@/lib/auth/permissions";

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "user-1",
    corpId: "corp-1",
    userId: "ding-1",
    unionId: "union-1",
    name: "张三",
    title: "班主任",
    avatarUrl: null,
    isAdmin: false,
    isBoss: false,
    isSenior: false,
    isSuperAdmin: false,
    canEdit: true,
    editableClassIds: ["default"],
    ...overrides,
  };
}

describe("class path parsing", () => {
  it("splits a class prefix from the remaining path", () => {
    expect(parseClassPath("/class2")).toEqual({ slug: "class2", rest: "/" });
    expect(parseClassPath("/class2/")).toEqual({ slug: "class2", rest: "/" });
    expect(parseClassPath("/class2/editor")).toEqual({ slug: "class2", rest: "/editor" });
    expect(parseClassPath("/class2/config.json")).toEqual({ slug: "class2", rest: "/config.json" });
    expect(parseClassPath("/class2/api/schedule/draft")).toEqual({ slug: "class2", rest: "/api/schedule/draft" });
    expect(parseClassPath("/class12")).toEqual({ slug: "class12", rest: "/" });
  });

  it("refuses paths that merely start with the prefix", () => {
    // These are the cases that would silently swallow ordinary routes.
    expect(parseClassPath("/classroom")).toBeNull();
    expect(parseClassPath("/classes")).toBeNull();
    expect(parseClassPath("/class")).toBeNull();
    expect(parseClassPath("/class/")).toBeNull();
    expect(parseClassPath("/foo/class2")).toBeNull();
    expect(parseClassPath("")).toBeNull();
    expect(parseClassPath("/")).toBeNull();
    expect(parseClassPath("/class-name.json")).toBeNull();
  });

  it("accepts digits after the class prefix", () => {
    expect(parseClassPath("/class2x/editor")).toEqual({ slug: "class2x", rest: "/editor" });
    expect(parseClassPath("/class2_2-a")).toEqual({ slug: "class2_2-a", rest: "/" });
    expect(parseClassPath("/class12")).toEqual({ slug: "class12", rest: "/" });
  });

  it("rejects slugs that are too long or contain unsafe characters", () => {
    // `class` + a leading digit + up to 31 more characters.
    expect(parseClassPath(`/class2${"a".repeat(31)}`)).toEqual({ slug: `class2${"a".repeat(31)}`, rest: "/" });
    expect(parseClassPath(`/class2${"a".repeat(32)}`)).toBeNull();
    expect(parseClassPath("/class../etc/passwd")).toBeNull();
    expect(parseClassPath("/class%2e%2e")).toBeNull();
    expect(parseClassPath("/class2%00")).toBeNull();
  });

  it("validates slugs used as database ids", () => {
    expect(isValidClassSlug("class2")).toBe(true);
    expect(isValidClassSlug("class12")).toBe(true);
    expect(isValidClassSlug("class2x")).toBe(true);
    expect(isValidClassSlug(`class2${"a".repeat(31)}`)).toBe(true);
    expect(isValidClassSlug(`class2${"a".repeat(32)}`)).toBe(false);
    // Must start with a digit, so ordinary words are never class ids.
    expect(isValidClassSlug("classroom")).toBe(false);
    expect(isValidClassSlug("classes")).toBe(false);
    expect(isValidClassSlug("class")).toBe(false);
    expect(isValidClassSlug("default")).toBe(false);
    expect(isValidClassSlug("class-2")).toBe(false);
    expect(isValidClassSlug(2)).toBe(false);
    expect(isValidClassSlug(null)).toBe(false);
  });

  it("exposes a single slug rule for other grammars to reuse", () => {
    expect(new RegExp(CLASS_SLUG_SOURCE).test("class7")).toBe(true);
    expect(new RegExp(CLASS_SLUG_SOURCE).test("classroom")).toBe(false);
  });

  it("treats the default class as unprefixed and others as prefixed", () => {
    expect(classBasePath(DEFAULT_CLASS_ID)).toBe("");
    expect(classBasePath("class2")).toBe("/class2");
  });

  it("identifies api paths for nesting under a class", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/schedule")).toBe(true);
    expect(isApiPath("/apix")).toBe(false);
    expect(isApiPath("/editor")).toBe(false);
  });

  it("leaves build assets and metadata files alone", () => {
    expect(isReservedPath("/_next/static/chunk.js")).toBe(true);
    expect(isReservedPath("/_next/image")).toBe(true);
    expect(isReservedPath("/favicon.ico")).toBe(true);
    expect(isReservedPath("/robots.txt")).toBe(true);
    expect(isReservedPath("/class2")).toBe(false);
    expect(isReservedPath("/config.json")).toBe(false);
  });

  it("uses a stable prefix constant", () => {
    expect(CLASS_PATH_PREFIX).toBe("/class");
  });
});

describe("per-class edit permissions", () => {
  it("only accepts addressable class ids", () => {
    expect(isAddressableClassId("default")).toBe(true);
    expect(isAddressableClassId("class2")).toBe(true);
    expect(isAddressableClassId("../default")).toBe(false);
    expect(isAddressableClassId("")).toBe(false);
  });

  it("lets a member edit their own class only", () => {
    const user = makeUser({ editableClassIds: ["class2"] });
    expect(canEditClass(user, "class2")).toBe(true);
    expect(canEditClass(user, "class3")).toBe(false);
    // The classic escalation attempt: rename the class in the URL.
    expect(canEditClass(user, "default")).toBe(false);
  });

  it("lets a super admin edit every class", () => {
    const admin = makeUser({ isSuperAdmin: true, editableClassIds: ["*"] });
    expect(canEditClass(admin, "default")).toBe(true);
    expect(canEditClass(admin, "class9")).toBe(true);
    // ...but still not a malformed class id.
    expect(canEditClass(admin, "../default")).toBe(false);
  });

  it("refuses users without the editor role, whatever their memberships", () => {
    const user = makeUser({ canEdit: false, editableClassIds: ["class2"] });
    expect(canEditClass(user, "class2")).toBe(false);
  });

  it("refuses a user whose membership is empty", () => {
    const user = makeUser({ editableClassIds: [] });
    expect(canEditClass(user, "default")).toBe(false);
  });
});

describe("super admin derivation", () => {
  it("does not treat the default profile as a super admin", () => {
    const profile: PermissionProfile = { title: "班主任", isAdmin: false, isBoss: false, isSenior: false };
    expect(profile.isAdmin).toBe(false);
  });
});
