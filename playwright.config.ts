import { defineConfig } from "@playwright/test";

const testPort = process.env.PLAYWRIGHT_PORT ?? "3100";
const testUrl = `http://localhost:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: process.env.BASE_URL ?? testUrl,
    trace: "retain-on-failure",
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: `npm run dev -- --port ${testPort}`,
    url: testUrl,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      DINGTALK_DEV_AUTH: "true",
      DINGTALK_DEV_USER_ID: "playwright-user",
      DINGTALK_DEV_UNION_ID: "playwright-union-user",
      DINGTALK_DEV_USER_NAME: "Playwright 测试用户",
      DINGTALK_DEV_USER_TITLE: "班主任",
      DINGTALK_DEV_USER_ADMIN: "false",
      DINGTALK_DEV_USER_BOSS: "false",
      DINGTALK_DEV_USER_SENIOR: "false",
      APP_ORIGIN: testUrl,
    },
  },
});
