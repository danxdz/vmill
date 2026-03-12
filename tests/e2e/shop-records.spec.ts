import { expect, test } from "@playwright/test";
import { acceptDialogs, loginAsAdmin, seedDemo, selectTypeByText } from "./helpers";

test("shop organizer custom folder is visible in records manager", async ({ page }) => {
  await loginAsAdmin(page);
  await seedDemo(page, "small");

  const folderName = `Zone E2E ${Date.now().toString().slice(-6)}`;
  await page.goto("/shop_tree.html");
  await expect(page.locator("#addRootBtn")).toBeVisible();

  page.once("dialog", async (dialog) => {
    await dialog.accept(folderName);
  });
  await page.click("#addRootBtn");
  await expect.poll(async () => page.evaluate((label) => document.body.innerText.includes(label), folderName)).toBe(true);

  await page.goto("/records_manager.html");
  await expect(page.locator("#typeSel")).toBeVisible();
  await expect.poll(async () => page.evaluate((label) => {
    const options = Array.from(document.querySelectorAll<HTMLSelectElement>("#typeSel option"));
    return options.some((opt) => String(opt.textContent || "").includes(label));
  }, folderName)).toBe(true);
});

test("records manager enter key saves a new row only once", async ({ page }) => {
  acceptDialogs(page);
  await loginAsAdmin(page);
  await seedDemo(page, "medium");
  await page.goto("/records_manager.html");
  await expect(page.locator("#typeSel")).toBeVisible();

  await selectTypeByText(page, /station/i);
  await page.click("#addRecordBtn");
  const newRow = page.locator('tr[data-row-new="1"]');
  await expect(newRow).toBeVisible();

  const uniqueName = `Station E2E ${Date.now().toString().slice(-6)}`;
  const nameInput = newRow.locator('[data-field-key="name"]').first();
  await expect(nameInput).toBeVisible();
  await nameInput.fill(uniqueName);
  await nameInput.press("Enter");

  await expect(newRow).toHaveCount(0, { timeout: 12_000 });
  await expect.poll(async () => page.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('#recordsBody tr[data-record-id]'));
    return rows.filter((row) => {
      const node = row.querySelector<HTMLInputElement>('[data-field-key="name"]');
      return String(node?.value || "").trim() === name;
    }).length;
  }, uniqueName)).toBe(1);
});
