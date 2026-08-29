import "server-only";

import { isDingTalkBoolean } from "@/lib/auth/permissions";

const TOKEN_ENDPOINT = "https://api.dingtalk.com/v1.0/oauth2";
const USER_INFO_ENDPOINT = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const USER_DETAILS_ENDPOINT = "https://oapi.dingtalk.com/topapi/v2/user/get";
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

type UnknownRecord = Record<string, unknown>;

export interface DingTalkPublicConfig {
  corpId: string;
  clientId: string;
}

export interface DingTalkProfile {
  corpId: string;
  userId: string;
  unionId: string;
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isBoss: boolean;
  isSenior: boolean;
}

export class DingTalkApiError extends Error {
  readonly code: string | number | undefined;

  constructor(message: string, code?: string | number) {
    super(message);
    this.name = "DingTalkApiError";
    this.code = code;
  }
}

let cachedAppToken: { value: string; expiresAt: number } | null = null;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result || null;
}

function numberValue(value: unknown, fallback: number): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result > 0 ? result : fallback;
}

function assertDingTalkSuccess(payload: unknown, operation: string): UnknownRecord {
  const root = asRecord(payload);
  if (!root) throw new DingTalkApiError(`${operation} 返回了无效响应`);

  const errorCode = root.errcode ?? root.errorCode;
  if (errorCode !== undefined && errorCode !== 0 && errorCode !== "0") {
    throw new DingTalkApiError(`${operation} 失败`, typeof errorCode === "string" || typeof errorCode === "number" ? errorCode : undefined);
  }

  return root;
}

function resultRecord(payload: UnknownRecord, operation: string): UnknownRecord {
  const result = asRecord(payload.result) ?? payload;
  if (!result) throw new DingTalkApiError(`${operation} 返回了无效结果`);
  return result;
}

async function requestJson(url: string, init: RequestInit, operation: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } catch {
    throw new DingTalkApiError(`${operation} 网络请求失败`);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new DingTalkApiError(`${operation} 请求失败`, response.status);
  return payload;
}

export function getDingTalkConfig(): { corpId: string; clientId: string; clientSecret: string } | null {
  const corpId = process.env.DINGTALK_CORP_ID?.trim();
  const clientId = process.env.DINGTALK_CLIENT_ID?.trim();
  const clientSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  if (!corpId || !clientId || !clientSecret) return null;
  return { corpId, clientId, clientSecret };
}

export function getDingTalkPublicConfig(): DingTalkPublicConfig {
  return {
    corpId: process.env.DINGTALK_CORP_ID?.trim() ?? "",
    clientId: process.env.DINGTALK_CLIENT_ID?.trim() ?? "",
  };
}

export function parseDingTalkBoolean(value: unknown): boolean {
  return isDingTalkBoolean(value);
}

export function parseDingTalkIdentity(payload: unknown): { userId: string; unionId: string } {
  const root = assertDingTalkSuccess(payload, "钉钉用户身份接口");
  const result = resultRecord(root, "钉钉用户身份接口");
  const userId = textValue(result.userid) ?? textValue(result.userId);
  const unionId = textValue(result.unionid) ?? textValue(result.unionId) ?? textValue(result.associated_unionid);
  if (!userId || !unionId) throw new DingTalkApiError("钉钉用户身份缺少必要标识");
  return { userId, unionId };
}

export function parseDingTalkProfile(
  payload: unknown,
  identity: { userId: string; unionId: string },
  corpId: string,
): DingTalkProfile {
  const root = assertDingTalkSuccess(payload, "钉钉用户详情接口");
  const result = resultRecord(root, "钉钉用户详情接口");
  return {
    corpId,
    userId: textValue(result.userid) ?? identity.userId,
    unionId: textValue(result.unionid) ?? identity.unionId,
    name: textValue(result.name) ?? identity.userId,
    title: textValue(result.title),
    avatarUrl: textValue(result.avatarUrl) ?? textValue(result.avatar),
    isAdmin: parseDingTalkBoolean(result.admin),
    isBoss: parseDingTalkBoolean(result.boss),
    isSenior: parseDingTalkBoolean(result.senior),
  };
}

export function resetDingTalkTokenCache() {
  cachedAppToken = null;
}

export async function getDingTalkAppAccessToken(): Promise<string> {
  const config = getDingTalkConfig();
  if (!config) throw new DingTalkApiError("钉钉服务端配置不完整");
  if (cachedAppToken && cachedAppToken.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return cachedAppToken.value;
  }

  const response = await requestJson(
    `${TOKEN_ENDPOINT}/${encodeURIComponent(config.corpId)}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "client_credentials",
      }),
    },
    "钉钉应用 Access Token",
  );
  const root = assertDingTalkSuccess(response, "钉钉应用 Access Token");
  const value = textValue(root.access_token) ?? textValue(root.accessToken);
  if (!value) throw new DingTalkApiError("钉钉应用 Access Token 响应缺少 token");

  const expiresIn = numberValue(root.expires_in ?? root.expiresIn, 7200);
  cachedAppToken = { value, expiresAt: Date.now() + expiresIn * 1000 };
  return value;
}

export async function fetchDingTalkProfile(authCode: string): Promise<DingTalkProfile> {
  const code = authCode.trim();
  if (!code || code.length > 4096) throw new DingTalkApiError("钉钉免登码无效");

  const config = getDingTalkConfig();
  if (!config) throw new DingTalkApiError("钉钉服务端配置不完整");
  const accessToken = await getDingTalkAppAccessToken();
  const identityPayload = await requestJson(
    `${USER_INFO_ENDPOINT}?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    },
    "钉钉用户身份接口",
  );
  const identity = parseDingTalkIdentity(identityPayload);
  const detailsPayload = await requestJson(
    `${USER_DETAILS_ENDPOINT}?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userid: identity.userId, language: "zh_CN" }),
    },
    "钉钉用户详情接口",
  );
  return parseDingTalkProfile(detailsPayload, identity, config.corpId);
}
