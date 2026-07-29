import { parse } from "csv-parse/browser/esm/sync";

export interface EnrollmentCsvRow {
  row: number;
  username: string;
  display_name: string;
  role: "teacher" | "ta" | "student";
  group?: string;
}

export interface EnrollmentCsvIssue { row: number; message: string }

const USERNAME = /^[a-zA-Z0-9_.@-]{1,100}$/;

export function parseEnrollmentCsv(source: string): { rows: EnrollmentCsvRow[]; issues: EnrollmentCsvIssue[] } {
  let records: Record<string, string>[];
  try {
    records = parse(source, {
      bom: true,
      columns: header => header.map((value: string) => value.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      max_record_size: 32_768,
    }) as Record<string, string>[];
  } catch (error) {
    return { rows: [], issues: [{ row: 1, message: error instanceof Error ? error.message : String(error) }] };
  }
  if (records.length > 10_000) return { rows: [], issues: [{ row: 1, message: "CSV 最多允许 10000 条成员记录" }] };
  const rows: EnrollmentCsvRow[] = [];
  const issues: EnrollmentCsvIssue[] = [];
  const usernames = new Set<string>();
  for (const [index, record] of records.entries()) {
    const row = index + 2;
    const username = record.username?.trim();
    const displayName = record.display_name?.trim();
    const role = record.role?.trim().toLowerCase();
    const group = record.group?.trim() || undefined;
    if (!username || !USERNAME.test(username)) issues.push({ row, message: "username 缺失或格式无效" });
    if (!displayName || displayName.length > 200) issues.push({ row, message: "display_name 缺失或超过 200 字符" });
    if (role !== "teacher" && role !== "ta" && role !== "student") issues.push({ row, message: "role 必须是 teacher、ta 或 student" });
    if (group && (group.length > 100 || role !== "student")) issues.push({ row, message: "group 仅允许学生使用且不能超过 100 字符" });
    const normalized = username?.toLowerCase();
    if (normalized && usernames.has(normalized)) issues.push({ row, message: "username 在 CSV 中重复" });
    if (normalized) usernames.add(normalized);
    if (username && displayName && (role === "teacher" || role === "ta" || role === "student")) rows.push({ row, username, display_name: displayName, role, group });
  }
  return { rows, issues };
}
