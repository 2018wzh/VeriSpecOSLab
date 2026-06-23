import type { Style } from "../tui/style.ts";
import type { StyleBlock, StyleConfig, StylePrimitive } from "./types.ts";

export const asciiStyle: StyleConfig = {
  document: { blockPrefix: "", blockSuffix: "" },
  blockQuote: { indent: 1, indentToken: "| " },
  paragraph: {},
  list: { levelIndent: 2 },
  heading: { blockSuffix: "" },
  h1: { prefix: "# " },
  h2: { prefix: "## " },
  h3: { prefix: "### " },
  h4: { prefix: "#### " },
  h5: { prefix: "##### " },
  h6: { prefix: "###### " },
  emph: { blockPrefix: "*", blockSuffix: "*" },
  strong: { blockPrefix: "**", blockSuffix: "**" },
  strikethrough: { blockPrefix: "~~", blockSuffix: "~~" },
  horizontalRule: { prefix: "--------" },
  item: { blockPrefix: "* " },
  enumeration: { blockPrefix: ". " },
  task: { ticked: "[x] ", unticked: "[ ] " },
  code: { blockPrefix: "`", blockSuffix: "`" },
  imageText: { prefix: "Image: ", suffix: " ->" },
};

export const darkStyle: StyleConfig = {
  document: {},
  blockQuote: { indent: 1, indentToken: "│ ", color: "cyan" },
  paragraph: {},
  list: { levelIndent: 2 },
  heading: { bold: true },
  h1: { prefix: " ", suffix: " ", color: "white", backgroundColor: "blue", bold: true },
  h2: { prefix: "## " },
  h3: { prefix: "### " },
  h4: { prefix: "#### " },
  h5: { prefix: "##### " },
  h6: { prefix: "###### ", bold: false, color: "magenta" },
  emph: { italic: true },
  strong: { bold: true },
  strikethrough: { faint: true },
  horizontalRule: { prefix: "--------", color: "blue" },
  item: { blockPrefix: "• " },
  enumeration: { blockPrefix: ". " },
  task: { ticked: "[✓] ", unticked: "[ ] " },
  link: { color: "cyan" },
  linkText: { color: "magenta", bold: true },
  image: { color: "cyan" },
  imageText: { prefix: "Image: ", suffix: " ->", color: "magenta" },
  code: { blockPrefix: "`", blockSuffix: "`", color: "yellow" },
  codeBlock: { color: "cyan", margin: 1 },
  table: {},
};

export const lightStyle: StyleConfig = {
  ...darkStyle,
  blockQuote: { indent: 1, indentToken: "│ ", color: "blue" },
  linkText: { color: "blue", bold: true },
  code: { blockPrefix: "`", blockSuffix: "`", color: "magenta" },
  codeBlock: { color: "blue", margin: 1 },
};

export const starsDarkStyle: StyleConfig = {
  ...darkStyle,
  blockQuote: { indent: 1, indentToken: "│ ", faint: true },
  h1: {},
  h2: {},
  h3: {},
  h4: {},
  h5: {},
  h6: {},
  horizontalRule: { prefix: "────────", faint: true },
  linkText: { color: "cyan" },
};

export const starsLightStyle: StyleConfig = {
  ...starsDarkStyle,
  blockQuote: { indent: 1, indentToken: "│ ", color: "blue" },
  link: { color: "blue" },
  linkText: { color: "blue" },
  code: { blockPrefix: "`", blockSuffix: "`", color: "blue" },
  codeBlock: { color: "blue", margin: 1 },
};

export const defaultStyleName = "dark";

export const defaultStyles: Readonly<Record<string, StyleConfig>> = {
  ascii: asciiStyle,
  dark: darkStyle,
  light: lightStyle,
  notty: asciiStyle,
  starsdark: starsDarkStyle,
  starslight: starsLightStyle,
};

export function normalizeStyleConfig(value: unknown): StyleConfig {
  return camelizeStyleObject(value) as StyleConfig;
}

export function styleToTerminalStyle(style: StylePrimitive | undefined): Style | undefined {
  if (style === undefined) {
    return undefined;
  }

  const terminalStyle: {
    bold?: true;
    dim?: true;
    italic?: true;
    fg?: Style["fg"];
    bg?: Style["bg"];
  } = {};

  if (style.bold) {
    terminalStyle.bold = true;
  }
  if (style.faint) {
    terminalStyle.dim = true;
  }
  if (style.italic) {
    terminalStyle.italic = true;
  }
  if (style.color) {
    terminalStyle.fg = style.color;
  }
  if (style.backgroundColor) {
    terminalStyle.bg = style.backgroundColor;
  }

  return Object.keys(terminalStyle).length > 0 ? terminalStyle : undefined;
}

export function mergePrimitive(
  parent: StylePrimitive | undefined,
  child: StylePrimitive | undefined,
): StylePrimitive {
  return {
    ...parent,
    ...child,
  };
}

export function mergeBlock(parent: StyleBlock | undefined, child: StyleBlock | undefined): StyleBlock {
  return {
    ...parent,
    ...child,
  };
}

export function mergeTerminalStyle(parent: Style | undefined, child: Style | undefined): Style | undefined {
  if (parent === undefined) {
    return child;
  }
  if (child === undefined) {
    return parent;
  }
  return {
    ...parent,
    ...child,
  };
}

function camelizeStyleObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => camelizeStyleObject(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    result[styleKey(key)] = camelizeStyleObject(field);
  }
  return result;
}

function styleKey(key: string): string {
  if (key === "hr") {
    return "horizontalRule";
  }
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
