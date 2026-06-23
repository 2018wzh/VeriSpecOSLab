export type StarsTuiTheme = "dark" | "light";

export type StarsTuiThemeEnv = Readonly<{
  STARS_TUI_THEME?: string;
  COLORFGBG?: string;
}>;

/** Resolve the terminal theme hint used by markdown rendering styles. */
export function resolveStarsTuiTheme(env: StarsTuiThemeEnv = defaultThemeEnv()): StarsTuiTheme {
  const explicit = env.STARS_TUI_THEME?.trim().toLocaleLowerCase();
  if (explicit === "dark" || explicit === "light") {
    return explicit;
  }

  return themeFromColorFgBg(env.COLORFGBG) ?? "dark";
}

function themeFromColorFgBg(value: string | undefined): StarsTuiTheme | undefined {
  if (!value) {
    return undefined;
  }

  const background = Number.parseInt(value.split(";").at(-1) ?? "", 10);
  if (!Number.isFinite(background)) {
    return undefined;
  }

  return background >= 7 && background <= 15 && background !== 8 ? "light" : "dark";
}

function defaultThemeEnv(): StarsTuiThemeEnv {
  return {
    STARS_TUI_THEME: process.env.STARS_TUI_THEME,
    COLORFGBG: process.env.COLORFGBG,
  };
}
