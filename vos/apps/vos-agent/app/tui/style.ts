export type AnsiColor =
  | "default"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightGreen"
  | `#${string}`;

export type Style = Readonly<{
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  fg?: AnsiColor;
  bg?: AnsiColor;
}>;

export const defaultStyle: Style = Object.freeze({});

export function normalizeStyle(style: Style | undefined = defaultStyle): Style {
  const normalized: {
    bold?: true;
    dim?: true;
    italic?: true;
    fg?: AnsiColor;
    bg?: AnsiColor;
  } = {};

  if (style.bold) {
    normalized.bold = true;
  }
  if (style.dim) {
    normalized.dim = true;
  }
  if (style.italic) {
    normalized.italic = true;
  }
  if (style.fg !== undefined && style.fg !== "default") {
    normalized.fg = style.fg;
  }
  if (style.bg !== undefined && style.bg !== "default") {
    normalized.bg = style.bg;
  }

  if (
    normalized.bold === undefined &&
    normalized.dim === undefined &&
    normalized.italic === undefined &&
    normalized.fg === undefined &&
    normalized.bg === undefined
  ) {
    return defaultStyle;
  }

  return normalized;
}

export function isDefaultStyle(style: Style | undefined): boolean {
  return stylesEqual(style, defaultStyle);
}

export function stylesEqual(left: Style | undefined, right: Style | undefined): boolean {
  const normalizedLeft = normalizeStyle(left);
  const normalizedRight = normalizeStyle(right);

  return (
    Boolean(normalizedLeft.bold) === Boolean(normalizedRight.bold) &&
    Boolean(normalizedLeft.dim) === Boolean(normalizedRight.dim) &&
    Boolean(normalizedLeft.italic) === Boolean(normalizedRight.italic) &&
    (normalizedLeft.fg ?? "default") === (normalizedRight.fg ?? "default") &&
    (normalizedLeft.bg ?? "default") === (normalizedRight.bg ?? "default")
  );
}
