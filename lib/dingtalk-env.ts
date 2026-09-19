export const DINGTALK_OUTSIDE_PLATFORM = "notInDingTalk";

/**
 * The DingTalk JSAPI reports "notInDingTalk" when the page runs outside the
 * DingTalk container. Any other platform value means the auth flow can run.
 */
export function isDingTalkContainer(platform: unknown): boolean {
  return typeof platform === "string" && platform.length > 0 && platform !== DINGTALK_OUTSIDE_PLATFORM;
}

