import { isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 200_000;

export type ToolArgumentParseResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

export type ToolStringArgumentResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type ToolBooleanArgumentResult =
  | { ok: true; value: boolean }
  | { ok: false; error: string };

export type ToolIntegerArgumentResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export type ToolPathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export function parseToolArguments(
  toolName: string,
  argumentsJson: string,
): ToolArgumentParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch (e) {
    return {
      ok: false,
      error: `Error parsing ${toolName} arguments: ${formatError(e)}`,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: expected a JSON object`,
    };
  }

  return { ok: true, args: parsed as Record<string, unknown> };
}

export function requireStringArgument(
  toolName: string,
  args: Record<string, unknown>,
  key: string,
  opts: { allowEmpty?: boolean; trimForEmptyCheck?: boolean } = {},
): ToolStringArgumentResult {
  const value = args[key];
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be a string`,
    };
  }

  const emptyCheckValue = opts.trimForEmptyCheck ? value.trim() : value;
  if (!opts.allowEmpty && emptyCheckValue.length === 0) {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be non-empty`,
    };
  }

  return { ok: true, value };
}

export function readOptionalBooleanArgument(
  toolName: string,
  args: Record<string, unknown>,
  key: string,
  defaultValue = false,
): ToolBooleanArgumentResult {
  const value = args[key];
  if (value === undefined) return { ok: true, value: defaultValue };
  if (typeof value !== "boolean") {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be a boolean`,
    };
  }
  return { ok: true, value };
}

export function readOptionalIntegerArgument(
  toolName: string,
  args: Record<string, unknown>,
  key: string,
  opts: { defaultValue: number; min?: number; max?: number },
): ToolIntegerArgumentResult {
  const value = args[key];
  if (value === undefined) return { ok: true, value: opts.defaultValue };
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be an integer`,
    };
  }
  if (opts.min !== undefined && value < opts.min) {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be >= ${opts.min}`,
    };
  }
  if (opts.max !== undefined && value > opts.max) {
    return {
      ok: false,
      error: `Error validating ${toolName} arguments: "${key}" must be <= ${opts.max}`,
    };
  }
  return { ok: true, value };
}

export function resolveWithinRoot(
  rootDir: string,
  filePath: string,
): ToolPathResult {
  const root = resolve(rootDir);
  const target = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(root, filePath);
  const rel = relative(root, target);
  const staysWithinRoot =
    rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));

  if (!staysWithinRoot) {
    return {
      ok: false,
      error: `Path escapes workspace root "${root}": ${filePath}`,
    };
  }

  return { ok: true, path: target };
}

export function truncateUtf8(
  text: string,
  maxBytes: number,
  label = "output",
): string {
  if (maxBytes <= 0) return text;

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;

  const truncated = Buffer.from(text, "utf8")
    .subarray(0, maxBytes)
    .toString("utf8");
  const omitted = bytes - maxBytes;
  return `${truncated}\n[${label} truncated: ${omitted} bytes omitted]`;
}

export function appendDiagnostic(output: string, diagnostic: string): string {
  if (!output) return diagnostic;
  const separator = output.endsWith("\n") ? "" : "\n";
  return `${output}${separator}${diagnostic}`;
}

export function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
