export function prettyPrint(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
