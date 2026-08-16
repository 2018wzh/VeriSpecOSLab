import { expect, test } from "@playwright/test";

const base = process.env.PORTAL_VISUAL_URL ?? "http://127.0.0.1:4173";

test("student stage to failed run evidence journey", async ({ page }) => {
  await page.goto(base);
  await page.getByRole("button", { name: /查看失败运行并修复|View failed run/ }).click();
  await expect(page).toHaveURL(/\/stages\?stage=/);
  await page.getByRole("link", { name: /运行与证据|Runs & evidence/ }).click();
  await page.getByRole("link", { name: /查看证据|View evidence/ }).first().click();
  await expect(page.getByRole("heading", { name: /证据时间线|Evidence timeline/ })).toBeVisible();
});

test("teacher rerun confirmation and notification focus", async ({ page }) => {
  await page.goto(base);
  await page.getByRole("button", { name: /退出|Sign out/ }).click();
  await page.getByRole("textbox", { name: /账号|Username/ }).fill("teacher");
  await page.getByRole("textbox", { name: /密码|Password/ }).fill("teacher");
  await page.getByRole("button", { name: /登录|Sign in/ }).click();
  await expect(page.getByRole("heading", { name: /课程运营|Course operations/ })).toBeVisible();
  await page.getByRole("button", { name: /处理首项|Handle first item/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /补跑理由|Rerun reason/ }).fill("复核公开失败结果并保留审计关联");
  await dialog.getByRole("button", { name: /确认补跑|Confirm rerun/ }).click();
  await expect(dialog).toBeHidden();
  const notifications = page.getByRole("button", { name: /通知|Notifications/ });
  await notifications.click();
  await expect(page.getByRole("region", { name: /通知|Notifications/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /通知|Notifications/ })).toBeHidden();
  await expect(notifications).toBeFocused();
});

test("mobile more navigation opens the accessible drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("button", { name: /导航|Navigation/ }).click();
  await expect(page.getByRole("navigation", { name: /主导航|Primary navigation/ }).last()).toBeVisible();
  await page.getByRole("link", { name: /运行与证据|Runs & evidence/ }).last().click();
  await expect(page).toHaveURL(/\/runs$/);
});
