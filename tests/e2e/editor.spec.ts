import { expect, test, type Page } from "@playwright/test";

const viewports = [320, 375, 414, 768];

async function openEditor(page: Page) {
  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();
}

test("authenticated editor shows the current local mock user", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "课程表" })).toBeVisible();
  const avatar = page.getByRole("button", { name: "当前用户头像" });
  await expect(avatar).toBeVisible();
  await expect(page.getByText(/本地测试用户|Playwright 测试用户/)).toHaveCount(0);
  await avatar.click();
  await expect(page.getByRole("link", { name: "编辑课表" })).toBeVisible();
  await expect(page.getByText("只读课表")).toBeVisible();
  await expect(page.getByText("退出登录")).toHaveCount(0);
  const authState = await page.evaluate(async () => {
    const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
    const me = await meResponse.json() as { user?: { canEdit?: boolean; isSuperAdmin?: boolean } };
    const publishedResponse = await fetch("/api/schedule/published", { cache: "no-store" });
    const adminResponse = await fetch("/api/admin/editor-policy", { cache: "no-store" });
    return {
      meStatus: meResponse.status,
      canEdit: me.user?.canEdit,
      isSuperAdmin: me.user?.isSuperAdmin,
      publishedStatus: publishedResponse.status,
      adminStatus: adminResponse.status,
    };
  });
  expect(authState).toEqual({ meStatus: 200, canEdit: true, isSuperAdmin: false, publishedStatus: 200, adminStatus: 403 });
  await page.screenshot({ path: "test-results/schedule-viewer.png", fullPage: true });
});

test("editor presence shows online editors from the avatar cluster", async ({ page }) => {
  await openEditor(page);
  const presence = page.locator(".editor-presence");
  await expect(presence).toBeVisible();
  await expect(page.getByText("退出登录")).toHaveCount(0);
  await presence.hover();
  const card = page.locator(".editor-presence-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("正在编辑");
  await expect(card).toContainText(/本地测试用户|Playwright 测试用户/);
  await expect(card).toContainText("返回预览视角");
  await expect(presence.locator(".presence-trigger")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(presence.locator(".presence-trigger")).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  const statusOrder = await page.locator(".topbar-status").evaluate((element) => [...element.children].map((child) => ({ className: String(child.className), label: child.getAttribute("aria-label") })));
  const presenceIndex = statusOrder.findIndex(({ className }) => className.includes("editor-presence"));
  const updateIndex = statusOrder.findIndex(({ className, label }) => className.includes("version-marker") && label?.startsWith("更新于"));
  expect(presenceIndex).toBe(statusOrder.length - 1);
  expect(updateIndex).toBeGreaterThanOrEqual(0);
  expect(updateIndex).toBeLessThan(presenceIndex);
  await page.screenshot({ path: "test-results/editor-presence-order.png", fullPage: true });
});

test("published viewer stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "课程表" })).toBeVisible();
  await expect(page.locator(".viewer-mobile-list")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/schedule-viewer-mobile.png", fullPage: true });
});

test("viewer week picker reveals four choices on hover", async ({ page }) => {
  await page.goto("/");
  const picker = page.locator(".viewer-week-picker");
  const options = page.locator(".viewer-week-options");
  await expect(picker.getByRole("button", { name: /查看第 1 周安排/ })).toBeVisible();
  await expect(options).toHaveCSS("visibility", "hidden");
  await picker.hover();
  await expect(options).toBeVisible();
  await expect(options.getByRole("option")).toHaveCount(4);
  await options.getByRole("option", { name: "第 3 周" }).click();
  await expect(picker.getByRole("button")).toContainText("查看第 3 周安排");
  await page.mouse.move(0, 0);
  await expect(options).toHaveCSS("visibility", "hidden");
});

async function clearTemporaryAdjustment(page: Page) {
  const version = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { temporaryAdjustment?: unknown; temporaryAdjustmentVersion?: number };
    return data.temporaryAdjustment ? data.temporaryAdjustmentVersion ?? 0 : null;
  });
  if (version === null) return;
  await page.evaluate(async (expectedAdjustmentVersion) => {
    await fetch("/api/schedule/adjustment", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedAdjustmentVersion }),
    });
  }, version);
  await page.reload();
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();
}

test("editor loads and follows the selected week", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator(".status-saved")).toHaveAttribute("aria-label", "草稿已保存");
  await page.locator(".course-cell").first().click();
  await page.getByRole("tab", { name: "第 2 周" }).click();
  await expect(page.getByRole("tab", { name: "第 2 周" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/editor-desktop.png", fullPage: true });
});

test("draft status expands from the version to the publish delta", async ({ page }) => {
  await openEditor(page);
  const status = page.locator(".draft-status-control");

  await expect(status.locator(".draft-status-version")).toHaveText(/^v\d+$/);
  await expect(status.locator(".draft-status-expanded")).toHaveCSS("opacity", "0");
  await status.hover();
  await expect(status.locator(".draft-status-expanded")).toHaveCSS("opacity", "1");
  await expect(status.locator(".draft-status-expanded")).toContainText("与已发布一致");
});

test("adjustment mode keeps toolbar slots and disables global actions", async ({ page }) => {
  await openEditor(page);
  await clearTemporaryAdjustment(page);

  await expect(page.locator(".topbar-actions .toolbar-publish-button")).toHaveCSS("border-width", "0px");
  const iconCenters = await page.evaluate(() => [...document.querySelectorAll(".topbar-actions .toolbar-icon-button")].map((button) => {
    const buttonRect = button.getBoundingClientRect();
    const icon = button.querySelector(".toolbar-icon-state.is-visible svg, .toolbar-export-glyph > svg") ?? button.querySelector("svg");
    const iconRect = icon?.getBoundingClientRect();
    return { buttonCenter: buttonRect.left + buttonRect.width / 2, iconCenter: iconRect ? iconRect.left + iconRect.width / 2 : null };
  }));
  expect(iconCenters.every(({ buttonCenter, iconCenter }) => iconCenter !== null && Math.abs(buttonCenter - iconCenter) < 0.5)).toBe(true);
  await page.locator(".adjustment-trigger").click();
  await expect(page.locator(".editor-shell")).toHaveClass(/is-adjustment-mode/);
  await expect(page.locator(".adjustment-trigger")).toHaveAttribute("aria-label", "放弃调课");
  await expect(page.locator(".toolbar-publish-button")).toHaveAttribute("aria-label", "保存调课");

  const disabledActions = page.locator(".topbar-actions .toolbar-action-disabled");
  await expect(disabledActions).toHaveCount(3);
  expect(await disabledActions.evaluateAll((elements) => elements.every((element) => element.hasAttribute("disabled")))).toBe(true);
  const exportMenu = page.locator(".export-menu");
  await expect(exportMenu).toHaveClass(/is-adjustment-disabled/);
  await exportMenu.hover();
  await expect(page.locator(".export-menu-popover")).toHaveCSS("visibility", "hidden");
  await expect(page.locator(".export-menu-popover")).toHaveCSS("pointer-events", "none");
  await expect(page.locator(".adjustment-mode-reveal")).toHaveCSS("opacity", "1");
  expect(await disabledActions.first().evaluate((element) => getComputedStyle(element, "::before").opacity)).toBe("0.82");

  await page.locator(".adjustment-trigger").click();
  await expect(page.locator(".editor-shell")).not.toHaveClass(/is-adjustment-mode/);
});

test("toast notices dismiss themselves after a short delay", async ({ page }) => {
  await openEditor(page);
  await clearTemporaryAdjustment(page);
  await page.getByRole("button", { name: "调课模式" }).click();
  await expect(page.locator(".notice")).toContainText("已进入调课模式");
  await page.waitForTimeout(3600);
  await expect(page.locator(".notice")).toHaveCount(0);
});

test("dragging moves the original card without creating an overlay", async ({ page }) => {
  await openEditor(page);
  const card = page.locator(".desktop-matrix .course-cell").first();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 30, { steps: 8 });
  await page.waitForTimeout(80);
  await expect(page.locator(".drag-overlay")).toHaveCount(0);
  await expect(card).toHaveClass(/is-dragging/);
  expect(await card.evaluate((element) => getComputedStyle(element).zIndex)).toBe("30");
  const movedBox = await card.boundingBox();
  expect(movedBox).not.toBeNull();
  if (movedBox) expect(movedBox.x).toBeGreaterThan(box.x + 40);
  await page.mouse.move(10, 10);
  await page.mouse.up();
});

test("dragging swaps the course under the pointer even when grabbed off center", async ({ page }) => {
  await openEditor(page);
  await clearTemporaryAdjustment(page);
  const draftBefore = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { draftConfig: unknown };
    return data.draftConfig;
  });
  const cells = page.locator(".desktop-matrix .course-cell");
  const sourceIndex = 0;
  const labels = await cells.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")));
  const targetIndex = labels.findIndex((label, index) => index > sourceIndex && label !== labels[sourceIndex]);
  expect(targetIndex).toBeGreaterThan(sourceIndex);
  if (targetIndex <= sourceIndex) return;
  const source = cells.nth(sourceIndex);
  const target = cells.nth(targetIndex);
  const sourceBefore = await source.getAttribute("aria-label");
  const targetBefore = await target.getAttribute("aria-label");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!sourceBox || !targetBox) return;

  try {
    await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width - 8, targetBox.y + targetBox.height - 8, { steps: 10 });
    await page.mouse.up();
    await expect(source).toHaveAttribute("aria-label", targetBefore ?? "");
    await expect(target).toHaveAttribute("aria-label", sourceBefore ?? "");
  } finally {
    await page.evaluate(async (config) => {
      const currentResponse = await fetch("/api/schedule", { cache: "no-store" });
      const current = await currentResponse.json() as { draftVersion: number };
      await fetch("/api/schedule/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, expectedDraftVersion: current.draftVersion }),
      });
    }, draftBefore);
  }
});

test("dragging swaps two courses in the same day column on Sunday and Monday", async ({ page }) => {
  await openEditor(page);
  const draftBefore = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { draftConfig: unknown };
    return data.draftConfig;
  });

  try {
    for (const dayHeaderIndex of [0, 1]) {
      await page.locator(".day-header").nth(dayHeaderIndex).getByRole("button").click();
      const classRows = page.locator(".desktop-matrix .matrix-row:not(.matrix-row-event)");
      const source = classRows.nth(0).locator(".course-cell").first();
      const target = classRows.nth(1).locator(".course-cell").first();
      const sourceBefore = await source.getAttribute("aria-label");
      const targetBefore = await target.getAttribute("aria-label");
      const sourceBox = await source.boundingBox();
      const targetBox = await target.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(targetBox).not.toBeNull();
      if (!sourceBox || !targetBox) return;

      await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
      await expect(target).toHaveClass(/is-over/);
      await page.mouse.up();
      await expect(source).toHaveAttribute("aria-label", targetBefore ?? "");
      await expect(target).toHaveAttribute("aria-label", sourceBefore ?? "");
    }
  } finally {
    await page.evaluate(async (config) => {
      const currentResponse = await fetch("/api/schedule", { cache: "no-store" });
      const current = await currentResponse.json() as { draftVersion: number };
      await fetch("/api/schedule/draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, expectedDraftVersion: current.draftVersion }),
      });
    }, draftBefore);
  }
});

test("dragging over a non-course area does not focus a nearby course", async ({ page }) => {
  await openEditor(page);
  await page.locator(".day-header").first().getByRole("button").click();
  const source = page.locator(".desktop-matrix .course-cell").first();
  const nonCourseArea = page.locator(".desktop-matrix .disabled-cell").first();
  const sourceBox = await source.boundingBox();
  const nonCourseBox = await nonCourseArea.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(nonCourseBox).not.toBeNull();
  if (!sourceBox || !nonCourseBox) return;

  await page.mouse.move(sourceBox.x + 8, sourceBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(nonCourseBox.x + nonCourseBox.width / 2, nonCourseBox.y + nonCourseBox.height / 2, { steps: 10 });
  await expect(page.locator(".course-cell.is-over")).toHaveCount(0);
  await page.mouse.up();
});

test("rail separators resize with keyboard controls", async ({ page }) => {
  await openEditor(page);
  const leftSeparator = page.getByRole("separator", { name: "调整左侧栏宽度" });
  const before = Number(await leftSeparator.getAttribute("aria-valuenow"));
  await leftSeparator.press("ArrowRight");
  const after = Number(await leftSeparator.getAttribute("aria-valuenow"));
  expect(after).toBe(before + 16);
});

test("copy-week control is hidden for a non-rotating course", async ({ page }) => {
  await openEditor(page);
  await page.locator(".desktop-matrix .course-cell").first().click();
  await expect(page.getByRole("combobox", { name: "目标周次" })).toBeHidden();
});

test("adjustment mode isolates course edits behind confirm and cancel controls", async ({ page }) => {
  await openEditor(page);
  await clearTemporaryAdjustment(page);
  const draftBefore = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { draftConfig: { daily_class: Array<{ classList: unknown[] }> } };
    return data.draftConfig.daily_class[1]?.classList[0];
  });

  await page.getByRole("button", { name: "调课模式" }).click();
  await expect(page.locator(".editor-shell.is-adjustment-mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存调课" })).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃调课" })).toBeVisible();
  await expect(page.getByRole("button", { name: "调课时效" })).toBeVisible();
  await expect(page.getByRole("button", { name: "日程模板" })).toHaveCount(0);

  await page.locator(".desktop-matrix .course-cell").first().click();
  const course = page.getByLabel("课程", { exact: true });
  const current = await course.inputValue();
  const values = await course.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const replacement = values.find((value) => value !== current);
  expect(replacement).toBeTruthy();
  if (replacement) await course.selectOption(replacement);
  await expect(page.locator(".adjustment-mode-status")).toContainText("等待保存");

  await page.getByRole("button", { name: "放弃调课" }).click();
  await expect(page.getByRole("button", { name: "调课模式" })).toBeVisible();
  await expect(page.locator(".editor-shell.is-adjustment-mode")).toHaveCount(0);
  const draftAfter = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { draftConfig: { daily_class: Array<{ classList: unknown[] }> }; temporaryAdjustment?: unknown };
    return { value: data.draftConfig.daily_class[1]?.classList[0], hasAdjustment: Boolean(data.temporaryAdjustment) };
  });
  expect(draftAfter.value).toEqual(draftBefore);
  expect(draftAfter.hasAdjustment).toBe(false);
});

test("saving an adjustment keeps it pending until publish and supports clearing", async ({ page }) => {
  await openEditor(page);
  await clearTemporaryAdjustment(page);
  const scheduleBefore = await page.evaluate(async () => {
    const response = await fetch("/config.json", { cache: "no-store" });
    const publicConfig = await response.json() as { daily_class: Array<{ classList: unknown[] }> };
    const editorResponse = await fetch("/api/schedule", { cache: "no-store" });
    const editor = await editorResponse.json() as {
      draftConfig: { daily_class: Array<{ classList: unknown[] }> };
    };
    return {
      publicFirst: publicConfig.daily_class[1]?.classList[0],
      draftFirst: editor.draftConfig.daily_class[1]?.classList[0],
    };
  });

  await page.getByRole("button", { name: "调课模式" }).click();
  await page.locator(".desktop-matrix .course-cell").first().click();
  const course = page.getByLabel("课程", { exact: true });
  const current = await course.inputValue();
  const values = await course.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const replacement = values.find((value) => value !== current);
  expect(replacement).toBeTruthy();
  if (!replacement) return;
  await course.selectOption(replacement);
  await page.getByRole("button", { name: "保存调课" }).click();
  await expect(page.locator(".notice")).toContainText("已保存本周调课草稿");
  await expect(page.locator(".temporary-adjustment-status")).toContainText("调课待发布");
  await expect(page.getByRole("button", { name: "取消调课草稿" }).first()).toBeVisible();
  expect(await page.locator(".course-cell.is-adjusted").count()).toBeGreaterThan(0);
  await expect(page.locator(".adjustment-badge").first()).toContainText("暂调");
  await expect(page.locator(".adjustment-target").first()).toContainText("调至");
  await expect(page.locator(".course-cell.is-adjusted").first()).toHaveAttribute("title", /本周暂调/);

  const pendingState = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { temporaryAdjustment?: { status?: string } };
    return data.temporaryAdjustment?.status;
  });
  expect(pendingState).toBe("draft");
  const publicWhilePending = await page.evaluate(async () => {
    const response = await fetch("/config.json", { cache: "no-store" });
    const config = await response.json() as { daily_class: Array<{ classList: unknown[] }> };
    return config.daily_class[1]?.classList[0];
  });
  expect(publicWhilePending).toEqual(scheduleBefore.publicFirst);

  await page.getByRole("button", { name: "发布草稿" }).click();
  await expect(page.locator(".notice")).toContainText("已发布草稿，本周调课已生效");
  await expect(page.locator(".temporary-adjustment-status")).toContainText("本周调课已生效");
  const publicAfterPublish = await page.evaluate(async () => {
    const response = await fetch("/config.json", { cache: "no-store" });
    const config = await response.json() as { daily_class: Array<{ classList: unknown[] }> };
    return config.daily_class[1]?.classList[0];
  });
  expect(publicAfterPublish).toBe(replacement);

  await page.getByRole("button", { name: "调课模式" }).click();
  await expect(page.locator(".notice")).toContainText("已加载本周临时调课");
  await page.getByRole("button", { name: "调课时效" }).click();
  await expect(page.getByRole("heading", { name: "调课时效" })).toBeVisible();
  await expect(page.getByText("一周 / 一次")).toBeVisible();
  await expect(page.getByText("本周调课已生效")).toBeVisible();

  await page.getByRole("button", { name: "放弃调课" }).click();
  await expect(page.getByRole("button", { name: "撤销本周调课" }).first()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销本周调课" }).first().click();
  await expect(page.locator(".notice")).toContainText("已清除本周调课，课表已恢复原课表");
  const adjustmentState = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json() as { temporaryAdjustment?: unknown };
    return Boolean(data.temporaryAdjustment);
  });
  expect(adjustmentState).toBe(false);
  const publicAfterClear = await page.evaluate(async () => {
    const response = await fetch("/config.json", { cache: "no-store" });
    const config = await response.json() as { daily_class: Array<{ classList: unknown[] }> };
    return config.daily_class[1]?.classList[0];
  });
  expect(publicAfterClear).toEqual(scheduleBefore.draftFirst);
});

test("adjustment mode stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openEditor(page);
  await clearTemporaryAdjustment(page);

  await page.getByRole("button", { name: "调课模式" }).click();
  await expect(page.locator(".mobile-nav").getByRole("button", { name: "时效" })).toBeVisible();
  await expect(page.locator(".mobile-nav").getByRole("button", { name: "模板" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "放弃调课" }).click();
});

test("course library guides simple and composite course codes", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "课程库" }).click();

  const form = page.getByTestId("subject-add-form");
  await expect(form.getByRole("radio", { name: "普通课程" })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByLabel("课程简称")).toBeVisible();

  await form.getByRole("radio", { name: "组合课程" }).click();
  await expect(form.getByLabel("第一段代码")).toBeVisible();
  await expect(form.getByLabel("第二段代码")).toBeVisible();
  await form.getByLabel("第一段代码").fill("自");
  await form.getByLabel("第二段代码").fill("语");
  await form.getByLabel("显示名称").fill("语文周测");
  await expect(form.getByTestId("add-subject-preview")).toContainText("自@语");

  await form.getByRole("button", { name: "新增课程" }).click();
  await expect(form.getByRole("alert")).toContainText("课程代码 自@语 已存在");
});

test("course library adds both entry modes without manual separators", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "课程库" }).click();
  const form = page.getByTestId("subject-add-form");

  const simpleCode = `T${Date.now()}`;
  await form.getByLabel("课程简称").fill(simpleCode);
  await form.getByLabel("显示名称").fill("临时课程");
  await form.getByRole("button", { name: "新增课程" }).click();
  await expect(page.locator(".notice")).toContainText(`添加成功：临时课程（${simpleCode}）`);
  const simpleRow = page.locator(`[data-subject-code="${simpleCode}"]`);
  await expect(simpleRow).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(simpleRow).toHaveCount(0);

  const compositeRightCode = `T${Date.now()}`;
  await form.getByRole("radio", { name: "组合课程" }).click();
  await form.getByLabel("第一段代码").fill("自");
  await form.getByLabel("第二段代码").fill(compositeRightCode);
  await form.getByLabel("显示名称").fill("临时组合课程");
  await expect(form.getByTestId("add-subject-preview")).toContainText(`自@${compositeRightCode}`);
  await form.getByRole("button", { name: "新增课程" }).click();
  const compositeCode = `自@${compositeRightCode}`;
  await expect(page.locator(".notice")).toContainText(`添加成功：临时组合课程（${compositeCode}）`);
  const compositeRow = page.locator(`[data-subject-code="${compositeCode}"]`);
  await expect(compositeRow).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(compositeRow).toHaveCount(0);
});

test("existing composite course opens with separate editable code fields", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "课程库" }).click();
  await page.getByRole("button", { name: "编辑 自@语" }).click();

  const form = page.locator(".library-edit-form");
  await expect(form.getByRole("radio", { name: "组合课程" })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByLabel("第一段代码")).toHaveValue("自");
  await expect(form.getByLabel("第二段代码")).toHaveValue("语");
  await form.getByRole("button", { name: "取消编辑" }).click();
});

test("course library shows actionable validation errors", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "课程库" }).click();
  const form = page.getByTestId("subject-add-form");

  await form.getByLabel("课程简称").fill("物");
  await form.getByLabel("显示名称").fill("重复课程");
  await form.getByRole("button", { name: "新增课程" }).click();
  await expect(form.getByRole("alert")).toContainText("课程代码 物 已存在");
  await expect(form.getByLabel("课程简称")).toHaveAttribute("aria-invalid", "true");

  await form.getByRole("radio", { name: "组合课程" }).click();
  await form.getByLabel("第一段代码").fill("自@");
  await form.getByLabel("第二段代码").fill("语");
  await form.getByLabel("显示名称").fill("非法组合");
  await form.getByRole("button", { name: "新增课程" }).click();
  await expect(form.getByRole("alert")).toContainText("这里不要输入 @");
  await expect(form.getByLabel("第一段代码")).toHaveAttribute("aria-invalid", "true");
});

test("countdown and weekday settings are available in the style panel", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "客户端样式" }).click();
  await expect(page.getByText("倒计时与星期")).toBeVisible();
  await expect(page.getByLabel("目标日期")).toBeVisible();
  await expect(page.getByText("隐藏目标倒计时")).toBeVisible();
  await expect(page.getByText("显示星期信息")).toBeVisible();
});

test("default client styles hide custom CSS controls", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "客户端样式" }).click();
  const panel = page.locator(".panel-style");
  const defaultStyles = panel.getByRole("checkbox", { name: "使用默认样式（不自定义）" });
  const customization = panel.locator(".style-customization");

  await defaultStyles.check();
  await expect(defaultStyles).toBeChecked();
  await expect(customization).toHaveClass(/is-hidden/);
  await expect(customization).toHaveAttribute("aria-hidden", "true");
  await expect(customization).toHaveCSS("opacity", "0");
  await expect(customization).toHaveCSS("grid-template-rows", "0px");
  await expect(customization).toHaveCSS("pointer-events", "none");
  await expect(panel.getByText("当前使用客户端默认样式。")).toBeVisible();

  await defaultStyles.uncheck();
  await expect(defaultStyles).not.toBeChecked();
  await expect(customization).not.toHaveClass(/is-hidden/);
  await expect(customization).toHaveAttribute("aria-hidden", "false");
  await expect(panel.locator(".style-fields")).toBeVisible();
  await expect(panel.locator(".style-fields input")).toHaveCount(14);
  await expect(panel.locator(".custom-style-form")).toBeVisible();
});

test("desktop workbench fills the viewport edges", async ({ page }) => {
  await openEditor(page);
  const workbench = page.locator(".editor-body");
  const bounds = await workbench.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(bounds.left).toBe(0);
  expect(bounds.right).toBe(bounds.viewport);
});

test("template rows use native time pickers", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "日程模板" }).click();
  await expect(page.locator(".template-row input[type=\"time\"]").first()).toBeVisible();
  await expect(page.locator(".add-row-form input[type=\"time\"]")).toHaveCount(2);
});

test("auto-arrange previews conflicts, applies a block, and can be undone", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "日程模板" }).click();
  const rows = page.locator(".template-rows .template-row");
  const rowsBefore = await rows.count();

  await page.getByRole("button", { name: "自动编排" }).click();
  await page.getByLabel("起始时间").fill("08:00");
  await page.getByLabel("连续节数").fill("4");
  await page.getByLabel("每节课程（分钟）").fill("40");
  await page.getByLabel("课间（分钟）").fill("10");

  const preview = page.getByTestId("auto-arrange-preview");
  await expect(preview).toContainText("结束于 11:10");
  await expect(preview).toContainText("将覆盖");
  await expect(preview.locator(".auto-arrange-preview-row")).toHaveCount(7);

  await page.getByRole("button", { name: "应用到当前模板" }).click();
  await expect(page.locator(".status-dirty")).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(rows).toHaveCount(rowsBefore);
});

test("auto-arrange stays usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openEditor(page);
  await page.locator(".mobile-nav").getByRole("button", { name: "模板" }).click();
  await page.getByRole("button", { name: "自动编排" }).click();
  await expect(page.getByLabel("起始时间")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("export menu stays open while moving from the trigger to an option", async ({ page }) => {
  await openEditor(page);
  const trigger = page.getByRole("button", { name: "导出配置" });
  const menu = page.getByRole("menu", { name: "导出选项" });
  const firstOption = page.getByRole("menuitem", { name: "导出草稿 JSON" });

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();

  const optionBox = await firstOption.boundingBox();
  expect(optionBox).not.toBeNull();
  if (optionBox) await page.mouse.move(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2, { steps: 6 });
  await expect(firstOption).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

for (const width of viewports) {
  test(`does not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openEditor(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/editor-${width}.png`, fullPage: true });
  });
}
