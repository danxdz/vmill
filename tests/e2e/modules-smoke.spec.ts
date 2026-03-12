import { expect, test } from "@playwright/test";
import { acceptDialogs, loginAsAdmin } from "./helpers";

test("core modules render without auth redirects", async ({ page }) => {
  acceptDialogs(page);
  await loginAsAdmin(page);

  const checks: Array<{ path: string; selector: string }> = [
    { path: "/chrono/chrono.html", selector: "#elapsed" },
    { path: "/SPaCial.html", selector: "#routeSel" },
    { path: "/factory_manager.html", selector: "#rows" },
    { path: "/logger.html", selector: "#loggerDock" },
    { path: "/shop_tree.html", selector: "#addRootBtn" },
    { path: "/records_manager.html", selector: "#addRecordBtn" },
    { path: "/contas_calc.html", selector: "#threadCalcBtn" },
  ];

  for (const check of checks) {
    await page.goto(check.path);
    await expect(page).not.toHaveURL(/\/login\.html/);
    await expect(page.locator(check.selector)).toBeVisible({ timeout: 20_000 });
  }

  await page.goto("/cnc_sim.html");
  await expect(page).not.toHaveURL(/\/login\.html/);
  await expect(page.getByRole("link", { name: "Open CNC App" })).toBeVisible();
});
