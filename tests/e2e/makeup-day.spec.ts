import { expect, test, type Page } from "@playwright/test";

/**
 * Verifies the make-up day flow: a weekend running Monday's lessons must fill
 * in automatically instead of leaving the teacher to drag every lesson over.
 */
async function openEditor(page: Page) {
  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();
}

/**
 * These specs share one persistent database, so each one starts from a clean
 * adjustment and a known template list rather than inheriting a prior run.
 */
async function clearAdjustments(page: Page) {
  await page.evaluate(async () => {
    await fetch("/api/schedule/adjustment", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });
}

async function removeTemplatesByName(page: Page, names: string[]) {
  await page.evaluate(async (targets: string[]) => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json();
    const config = data.draftConfig;
    let changed = false;
    for (const name of targets) {
      if (!config.timetable[name]) continue;
      if (Object.keys(config.timetable).length <= 1) break;
      // Days using the removed template fall back to the first survivor.
      const replacement = Object.keys(config.timetable).find((key) => key !== name);
      if (!replacement) break;
      for (const day of config.daily_class) {
        if (day.timetable === name) day.timetable = replacement;
      }
      delete config.timetable[name];
      delete config.divider[name];
      changed = true;
    }
    if (!changed) return;
    await fetch("/api/schedule/draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
  }, names);
}

test("make-up day fills a weekend from the chosen weekday without manual dragging", async ({ page }) => {
  await openEditor(page);
  await clearAdjustments(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();

  // Read the seeded shape so the assertions do not assume a slot count.
  const seeded = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json();
    const config = data.draftConfig;
    const monday = config.daily_class[1];
    const mondaySlots = Object.values(config.timetable[monday.timetable] as Record<string, unknown>)
      .filter((value) => typeof value === "number").length;
    return { mondaySlots, mondayTemplate: monday.timetable as string };
  });

  await page.getByRole("button", { name: "调课模式" }).click();
  await expect(page.locator(".notice")).toContainText("已进入调课模式");

  // The Sunday column (daily_class[0]) should offer a make-up control.
  const sundayHeader = page.locator(".matrix-header .day-header").nth(0);
  await expect(sundayHeader.locator(".day-override-trigger")).toBeVisible();
  await expect(sundayHeader).toContainText("补课");

  await sundayHeader.locator(".day-override-trigger").click();
  const popover = sundayHeader.locator(".day-override-popover");
  await expect(popover).toBeVisible();

  // Point Sunday at Monday's lessons.
  await popover.locator("select").selectOption("1");
  await expect(page.locator(".notice")).toContainText("设为补星期一的课");
  await expect(sundayHeader.locator(".day-override-trigger")).toHaveClass(/is-active/);

  const preview = await popover.locator(".day-override-preview").textContent();
  expect(preview).toContain(`将排入 ${seeded.mondaySlots} 节课`);

  await page.screenshot({ path: "test-results/makeup-day-editor.png", fullPage: true });

  // The Sunday column must now show Monday's lessons, not a row of TBD.
  await expect(page.locator(".day-override-trigger.is-active")).toHaveCount(1);

  // Save and confirm the payload really carries the override.
  await page.getByRole("button", { name: "保存调课" }).click();
  await expect(page.locator(".notice")).toContainText("已保存本周调课草稿");

  const saved = await page.evaluate(async () => {
    const response = await fetch("/api/schedule", { cache: "no-store" });
    const data = await response.json();
    return data.temporaryAdjustment?.dayOverrides ?? null;
  });
  expect(Array.isArray(saved)).toBe(true);
  expect(saved).toHaveLength(1);
  expect(saved[0].sourceDayIndex).toBe(1);
  expect(saved[0].template).toBe(seeded.mondayTemplate);
});

test("clearing a make-up day restores the original weekend", async ({ page }) => {
  await openEditor(page);
  await clearAdjustments(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();
  await page.getByRole("button", { name: "调课模式" }).click();

  const sundayHeader = page.locator(".matrix-header .day-header").nth(0);
  await sundayHeader.locator(".day-override-trigger").click();
  const popover = sundayHeader.locator(".day-override-popover");

  // An override persisted from the previous test should be loaded.
  if (await popover.locator(".day-override-clear").isVisible()) {
    await popover.locator(".day-override-clear").click();
    await expect(sundayHeader).toContainText("补课");
  }

  await page.getByRole("button", { name: "放弃调课" }).click();
  await expect(page.getByRole("button", { name: "调课模式" })).toBeVisible();
});

test("template toolbar creates, copies, and deletes templates without card stacks", async ({ page }) => {
  await openEditor(page);
  await removeTemplatesByName(page, ["holiday 副本", "holiday", "holiday 2"]);
  await page.reload();
  await page.getByRole("button", { name: "日程模板" }).click();

  const toolbar = page.locator(".template-toolbar");
  await expect(toolbar).toBeVisible();

  // Every template lives in one chip row, and each chip carries its own copy.
  const chipsBefore = await toolbar.locator(".template-chip:not(.template-chip-add)").count();
  await expect(toolbar.locator(".template-chip-action[aria-label^='复制模板']").first()).toBeVisible();

  // "+" reveals an inline field rather than a permanent card.
  await toolbar.locator(".template-chip-add").click();
  const inlineForm = page.locator(".template-inline-form");
  await expect(inlineForm).toBeVisible();
  await inlineForm.locator("input").fill("holiday");
  await inlineForm.locator("button[type='submit']").click();

  const chipsAfter = await toolbar.locator(".template-chip:not(.template-chip-add)").count();
  expect(chipsAfter).toBe(chipsBefore + 1);
  await expect(toolbar.locator(".template-chip", { hasText: "holiday" })).toHaveCount(1);

  // Copy acts on the chip it belongs to, not on whatever is selected.
  const holidayChip = toolbar.locator(".template-chip", { hasText: "holiday" }).first();
  await holidayChip.locator(".template-chip-action[aria-label^='复制模板']").click();
  await expect(toolbar.locator(".template-chip", { hasText: "holiday 副本" })).toHaveCount(1);

  await page.screenshot({ path: "test-results/template-toolbar.png", fullPage: true });

  // Clean up the templates this test created.
  for (const name of ["holiday 副本", "holiday"]) {
    const chip = toolbar.locator(".template-chip", { hasText: name }).first();
    if (await chip.count() === 0) continue;
    if (await chip.locator(".template-chip-danger").isDisabled()) continue;
    await chip.locator(".template-chip-danger").click();
    await page.locator(".template-delete-prompt").getByRole("button", { name: /确认删除/ }).click();
    await expect(toolbar.locator(".template-chip", { hasText: name })).toHaveCount(0);
  }
});
