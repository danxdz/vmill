import { expect, test } from "@playwright/test";
import { acceptDialogs, loginAsAdmin, seedDemo } from "./helpers";

test("hub scope toolbar reads seeded data and applies filters", async ({ page }) => {
  acceptDialogs(page);
  await loginAsAdmin(page);
  await seedDemo(page, "medium");

  await page.locator("#vmillScopeDock").hover();
  const scopeSelects = page.locator("#vmillScopeKpis select[data-scope-select]");
  await expect.poll(async () => scopeSelects.count()).toBeGreaterThan(1);

  const selectable = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLSelectElement>("#vmillScopeKpis select[data-scope-select]"));
    for (let i = 0; i < rows.length; i += 1) {
      const choices = Array.from(rows[i].options).filter((opt) => String(opt.value || "") !== "all");
      if (choices.length) {
        return { index: i, value: String(choices[0].value || "") };
      }
    }
    return null;
  });
  expect(selectable).not.toBeNull();
  if (!selectable) return;

  const changed = await page.evaluate((payload) => {
    const rows = Array.from(document.querySelectorAll<HTMLSelectElement>("#vmillScopeKpis select[data-scope-select]"));
    const row = rows[payload.index];
    if (!row) return false;
    row.value = payload.value;
    row.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, selectable);
  expect(changed).toBe(true);
  await expect.poll(async () => page.evaluate(() => {
    try {
      const raw = localStorage.getItem("vmill:hub-scope:v1");
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return Object.values(parsed?.selected || {})
        .map((v) => String(v || ""))
        .filter((v) => v && v !== "all").length;
    } catch {
      return 0;
    }
  })).toBeGreaterThan(0);

  await expect(page.locator("#jobsList .jobsExplorerCard, #jobsList .jobsFlatRow").first()).toBeVisible();
});

test("hub keeps layout usable on mobile width", async ({ page }) => {
  acceptDialogs(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  await seedDemo(page, "small");

  await expect(page.locator("#vmillScopeDock")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - window.innerWidth);
  });
  expect(overflow).toBeLessThanOrEqual(12);
});
