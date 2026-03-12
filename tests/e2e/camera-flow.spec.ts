import { expect, test } from "@playwright/test";
import { acceptDialogs, loginAsAdmin, seedDemo } from "./helpers";

test("camera module keeps selected product after creating product and job", async ({ page }) => {
  acceptDialogs(page);
  await loginAsAdmin(page);
  await seedDemo(page, "small");

  await page.goto("/chrono/chrono_camera.html");
  const skipBtn = page.locator("#skipCamBtn");
  if (await skipBtn.isVisible()) {
    await skipBtn.click();
  }

  await page.click("#cfgBtn");
  await expect(page.locator("#panel")).toHaveClass(/open/);
  await expect(page.locator("#prodSel")).toBeVisible();
  await expect(page.locator("#jobSel")).toBeVisible();

  const nameSuffix = Date.now().toString().slice(-6);
  const productName = `Prod E2E ${nameSuffix}`;
  await page.selectOption("#prodSel", "__new__");
  await expect.poll(async () => page.evaluate(() => {
    const node = document.getElementById("newProductSec");
    if (!node) return false;
    return getComputedStyle(node).display !== "none";
  })).toBe(true);
  await page.fill("#newProdName", productName);
  await page.click("#createProdBtn");

  await expect.poll(async () => page.locator("#prodSel").inputValue()).not.toBe("__new__");
  const selectedProductId = await page.locator("#prodSel").inputValue();
  expect(selectedProductId).toBeTruthy();

  const selectedProductLabel = await page.locator("#prodSel option:checked").textContent();
  expect(String(selectedProductLabel || "")).toContain(productName);

  const jobName = `Job E2E ${nameSuffix}`;
  await page.selectOption("#jobSel", "__new__");
  await expect(page.locator("#newJobSec")).toBeVisible();
  if (await page.locator("#autoSeqChk").isChecked()) {
    await page.locator("#autoSeqChk").uncheck();
  }

  const elementInput = page.locator("#elsList input").first();
  if (await elementInput.count()) {
    await elementInput.fill("Cycle step 1");
  } else {
    await page.click("#addElBtn");
    await page.locator("#elsList input").first().fill("Cycle step 1");
  }
  await page.fill("#newJobName", jobName);
  await page.click("#createJobBtn");

  await expect.poll(async () => page.locator("#jobSel").inputValue()).not.toBe("__new__");
  await expect(page.locator("#prodSel")).toHaveValue(selectedProductId);
});
