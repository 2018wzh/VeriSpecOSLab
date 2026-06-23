import { describe, expect, test } from "bun:test";
import { resolveStarsTuiTheme } from "../../app/tui/theme.ts";

describe("Stars TUI theme", () => {
  test("uses an explicit STARS_TUI_THEME when provided", () => {
    expect(resolveStarsTuiTheme({ STARS_TUI_THEME: "light", COLORFGBG: "15;0" })).toBe("light");
    expect(resolveStarsTuiTheme({ STARS_TUI_THEME: " dark ", COLORFGBG: "0;15" })).toBe("dark");
  });

  test("falls back to COLORFGBG background brightness", () => {
    expect(resolveStarsTuiTheme({ COLORFGBG: "15;0" })).toBe("dark");
    expect(resolveStarsTuiTheme({ COLORFGBG: "0;8" })).toBe("dark");
    expect(resolveStarsTuiTheme({ COLORFGBG: "0;7" })).toBe("light");
    expect(resolveStarsTuiTheme({ COLORFGBG: "0;15" })).toBe("light");
  });

  test("defaults to dark when the terminal does not expose a usable theme hint", () => {
    expect(resolveStarsTuiTheme({})).toBe("dark");
    expect(resolveStarsTuiTheme({ STARS_TUI_THEME: "auto", COLORFGBG: "bad" })).toBe("dark");
  });
});
