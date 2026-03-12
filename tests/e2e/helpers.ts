import { expect, Page } from "@playwright/test";

export const ADMIN_USER = "admin";
export const ADMIN_PASSWORD = "vmill2024";

export function acceptDialogs(page: Page): void {
  page.on("dialog", async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // Ignore.
    }
  });
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login.html");
  await expect(page.locator("#loginBtn")).toBeVisible();
  const origin = new URL(page.url()).origin;
  await page.fill("#serverUrlInput", origin);
  await page.fill("#usernameInput", ADMIN_USER);
  await page.fill("#passwordInput", ADMIN_PASSWORD);
  await page.click("#loginBtn");
  await expect(page).toHaveURL(/\/vmill_hub\.html$/);
  await expect(page.locator("#seedDemoBtn")).toBeVisible();
}

export async function seedDemo(page: Page, preset: "small" | "medium" | "large" = "medium"): Promise<void> {
  await page.selectOption("#seedDemoPresetSel", preset);
  await page.click("#seedDemoBtn");
  await expect.poll(
    async () => page.evaluate(() => {
      const app = window.VMillData?.readAppState?.({ seedIfMissing: false }) || null;
      return Array.isArray(app?.operations) ? app.operations.length : (Array.isArray(app?.jobs) ? app.jobs.length : 0);
    }),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
}

export async function selectTypeByText(page: Page, matcher: RegExp): Promise<string> {
  const value = await page.evaluate((source) => {
    const rx = new RegExp(source, "i");
    const options = Array.from(document.querySelectorAll<HTMLSelectElement>("#typeSel option"));
    const picked = options.find((opt) => rx.test(String(opt.textContent || "")));
    return String(picked?.value || "");
  }, matcher.source);
  if (!value) throw new Error(`No type option matched /${matcher.source}/i`);
  await page.selectOption("#typeSel", value);
  return value;
}
