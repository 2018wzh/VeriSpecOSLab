import { expect, test } from "@playwright/test";
import path from "node:path";

const base = process.env.PORTAL_VISUAL_URL ?? "http://127.0.0.1:4173";
const output = process.env.PORTAL_VISUAL_OUTPUT ?? path.resolve(import.meta.dirname, "../../../../..", ".tmp", "portal-visual-actual");

for (const theme of [
  { name: "dark", colorScheme: "dark" as const },
  { name: "reduced-motion", reducedMotion: "reduce" as const },
  { name: "forced-colors", forcedColors: "active" as const },
]) {
  test(`Fluent theme ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.emulateMedia(theme);
    await page.goto(base);
    await expect(page.getByRole("heading", { name: /学习工作台|Learning workspace/ })).toBeVisible();
    await expect(page.locator(".portal-provider")).toBeVisible();
    await page.screenshot({ path: path.join(output, `student-${theme.name}.png`), fullPage: true });
  });
}
