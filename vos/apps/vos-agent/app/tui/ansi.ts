import { normalizeStyle } from "./style.ts";
import type { AnsiColor, Style } from "./style.ts";

const CSI = "\x1b[";
const OSC = "\x1b]";
const ST = "\x1b\\";

type NamedColor = Exclude<AnsiColor, "default" | `#${string}`>;

const foregroundCodes: Record<NamedColor, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightGreen: 92,
};

const backgroundCodes: Record<NamedColor, number> = {
  black: 40,
  red: 41,
  green: 42,
  yellow: 43,
  blue: 44,
  magenta: 45,
  cyan: 46,
  white: 47,
  brightGreen: 102,
};

export function cursorTo(row: number, col: number): string {
  assertPositiveInteger(row, "row");
  assertPositiveInteger(col, "col");

  return `${CSI}${row};${col}H`;
}

export function sgr(style?: Style): string {
  const normalized = normalizeStyle(style);
  const codes = ["0"];

  if (normalized.bold) {
    codes.push("1");
  }
  if (normalized.dim) {
    codes.push("2");
  }
  if (normalized.italic) {
    codes.push("3");
  }
  if (normalized.fg !== undefined && normalized.fg !== "default") {
    codes.push(...colorCodes(normalized.fg, "fg"));
  }
  if (normalized.bg !== undefined && normalized.bg !== "default") {
    codes.push(...colorCodes(normalized.bg, "bg"));
  }

  return `${CSI}${codes.join(";")}m`;
}

export function hyperlinkStart(uri: string): string {
  const sanitized = sanitizeOsc8Uri(uri);
  return sanitized.length === 0 ? hyperlinkEnd() : `${OSC}8;;${sanitized}${ST}`;
}

export function hyperlinkEnd(): string {
  return `${OSC}8;;${ST}`;
}

function colorCodes(color: Exclude<AnsiColor, "default">, target: "fg" | "bg"): string[] {
  const rgb = parseHexColor(color);
  if (rgb) {
    return [target === "fg" ? "38" : "48", "2", String(rgb.red), String(rgb.green), String(rgb.blue)];
  }
  if (color.startsWith("#")) {
    return [];
  }

  return [String(target === "fg" ? foregroundCodes[color as NamedColor] : backgroundCodes[color as NamedColor])];
}

function parseHexColor(color: string): { red: number; green: number; blue: number } | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!match) {
    return undefined;
  }

  const value = match[1];
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

function sanitizeOsc8Uri(uri: string): string {
  return uri.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function beginSynchronizedOutput(): string {
  return `${CSI}?2026h`;
}

export function endSynchronizedOutput(): string {
  return `${CSI}?2026l`;
}

export function enterAlternateScreen(): string {
  return `${CSI}?1049h`;
}

export function leaveAlternateScreen(): string {
  return `${CSI}?1049l`;
}

export function enableMouseReporting(): string {
  return `${CSI}?1000h${CSI}?1006h`;
}

export function disableMouseReporting(): string {
  return `${CSI}?1006l${CSI}?1000l`;
}

export function hideCursor(): string {
  return `${CSI}?25l`;
}

export function showCursor(): string {
  return `${CSI}?25h`;
}

export function clearScreen(): string {
  return `${CSI}2J`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
