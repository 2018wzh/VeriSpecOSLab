import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function readProjectEnv(projectRoot: string): Record<string, string> {
  const envPath = path.resolve(projectRoot, ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  const raw = readFileSync(envPath, "utf8");
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    out[parsed.key] = parsed.value;
  }

  return out;
}

export async function withProjectEnv<T>(
  projectRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const loaded = readProjectEnv(projectRoot);
  const snapshot = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(loaded)) {
    snapshot.set(key, process.env[key]);
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, previous] of snapshot) {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
    }
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  if (trimmed.startsWith("export ")) {
    trimmed = trimmed.slice("export ".length).trimStart();
  }

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex <= 0) return undefined;

  const key = trimmed.slice(0, equalsIndex).trim();
  if (!key) return undefined;

  return {
    key,
    value: parseEnvValue(trimmed.slice(equalsIndex + 1)),
  };
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith('"')) {
    return parseDoubleQuotedValue(trimmed);
  }

  if (trimmed.startsWith("'")) {
    return parseSingleQuotedValue(trimmed);
  }

  return stripInlineComment(trimmed).trim();
}

function parseDoubleQuotedValue(value: string): string {
  let out = "";
  let escaped = false;

  for (let i = 1; i < value.length; i++) {
    const char = value[i];
    if (escaped) {
      out += decodeEscape(char);
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return out;
    }
    out += char;
  }

  return out;
}

function parseSingleQuotedValue(value: string): string {
  let out = "";
  for (let i = 1; i < value.length; i++) {
    const char = value[i];
    if (char === "'") {
      return out;
    }
    out += char;
  }
  return out;
}

function stripInlineComment(value: string): string {
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"') {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return value.slice(0, i).trimEnd();
    }
  }

  return value;
}

function decodeEscape(char: string): string {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "'":
      return "'";
    default:
      return char;
  }
}
