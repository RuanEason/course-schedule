import { expect, test } from "@playwright/test";

/** Guards the chip alignment so it cannot regress silently. */
test("template chip text and icons stay vertically centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editor");
  await expect(page.getByRole("heading", { name: "星期矩阵" })).toBeVisible();
  await page.getByRole("button", { name: "日程模板" }).click();

  const toolbar = page.locator(".template-toolbar");
  await expect(toolbar).toBeVisible();

  // Baseline alignment on the chip label used to push text ~2.4px above the
  // chip centre, which read as "the new buttons sit too high".
  const offsets = await toolbar.evaluate((root) => {
    const result: number[] = [];
    for (const chip of [...root.querySelectorAll(".template-chip")] as HTMLElement[]) {
      const chipBox = chip.getBoundingClientRect();
      const chipCenter = chipBox.top + chipBox.height / 2;
      const targets = [
        chip.querySelector(".template-chip-select"),
        ...chip.querySelectorAll("svg"),
      ].filter(Boolean) as Element[];
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        result.push(Number(((box.top + box.height / 2) - chipCenter).toFixed(2)));
      }
    }
    return result;
  });

  expect(offsets.length).toBeGreaterThan(0);
  expect(Math.max(...offsets.map((value) => Math.abs(value)))).toBeLessThanOrEqual(1);
});
