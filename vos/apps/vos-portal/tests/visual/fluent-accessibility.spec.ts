import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const base = process.env.PORTAL_VISUAL_URL ?? "http://127.0.0.1:4173";

test("student workspace has no automated accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(base);
  await expect(page.getByRole("heading", { name: /学习工作台|Learning workspace/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("teacher operations has no automated accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(base);
  await page.getByRole("button", { name: /退出|Sign out/ }).click();
  await page.getByRole("textbox", { name: /账号|Username/ }).fill("teacher");
  await page.getByRole("textbox", { name: /密码|Password/ }).fill("teacher");
  await page.getByRole("button", { name: /登录|Sign in/ }).click();
  await expect(page.getByRole("heading", { name: /课程运营|Course operations/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
