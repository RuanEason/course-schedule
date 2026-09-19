import { describe, expect, it } from "vitest";

import { DINGTALK_OUTSIDE_PLATFORM, isDingTalkContainer } from "@/lib/dingtalk-env";

describe("DingTalk container detection", () => {
  it("treats the notInDingTalk platform as outside the container", () => {
    expect(isDingTalkContainer(DINGTALK_OUTSIDE_PLATFORM)).toBe(false);
    expect(isDingTalkContainer("notInDingTalk")).toBe(false);
  });

  it("keeps every DingTalk platform inside the container", () => {
    expect(isDingTalkContainer("ios")).toBe(true);
    expect(isDingTalkContainer("android")).toBe(true);
    expect(isDingTalkContainer("pc")).toBe(true);
    expect(isDingTalkContainer("harmony")).toBe(true);
    expect(isDingTalkContainer("windows")).toBe(true);
    expect(isDingTalkContainer("mac")).toBe(true);
  });

  it("treats a missing platform as outside the container", () => {
    expect(isDingTalkContainer(undefined)).toBe(false);
    expect(isDingTalkContainer(null)).toBe(false);
    expect(isDingTalkContainer("")).toBe(false);
    expect(isDingTalkContainer(0)).toBe(false);
  });
});

