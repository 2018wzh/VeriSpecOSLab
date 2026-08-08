import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface AuditChainRecord {
  sequence: number;
  previous_hash: string | null;
  hash: string;
  recorded_at: string;
  event: unknown;
}

const AUDIT_RELATIVE_PATH = ".vos/audit/chain.jsonl";

/** Append one immutable audit event. The file is intentionally gitignored. */
export async function appendAuditEvent(projectRoot: string, event: unknown): Promise<AuditChainRecord> {
  const auditPath = path.join(projectRoot, AUDIT_RELATIVE_PATH);
  await mkdir(path.dirname(auditPath), { recursive: true });
  const previous = lastAuditRecord(auditPath);
  const recordWithoutHash = {
    sequence: (previous?.sequence ?? 0) + 1,
    previous_hash: previous?.hash ?? null,
    recorded_at: new Date().toISOString(),
    event,
  } satisfies Omit<AuditChainRecord, "hash">;
  const hash = createHash("sha256").update(JSON.stringify(recordWithoutHash)).digest("hex");
  const record: AuditChainRecord = { ...recordWithoutHash, hash };
  appendFileSync(auditPath, `${JSON.stringify(record)}\n`);
  return record;
}

export function verifyAuditChain(projectRoot: string): { ok: true; records: number; head?: string } | { ok: false; records: number; reason: string; sequence?: number } {
  const auditPath = path.join(projectRoot, AUDIT_RELATIVE_PATH);
  if (!existsSync(auditPath)) return { ok: true, records: 0 };
  const lines = readFileSync(auditPath, "utf8").split(/\r?\n/).filter(Boolean);
  let previous: AuditChainRecord | undefined;
  for (let index = 0; index < lines.length; index++) {
    let parsed: AuditChainRecord;
    try {
      parsed = JSON.parse(lines[index]) as AuditChainRecord;
    } catch {
      return { ok: false, records: index, reason: "invalid_json", sequence: index + 1 };
    }
    const expected = createHash("sha256").update(JSON.stringify({
      sequence: parsed.sequence,
      previous_hash: parsed.previous_hash,
      recorded_at: parsed.recorded_at,
      event: parsed.event,
    })).digest("hex");
    if (parsed.sequence !== index + 1 || parsed.previous_hash !== (previous?.hash ?? null) || parsed.hash !== expected) {
      return { ok: false, records: index, reason: "hash_gap", sequence: parsed.sequence };
    }
    previous = parsed;
  }
  return { ok: true, records: lines.length, head: previous?.hash };
}

export function auditChainPath(projectRoot: string): string {
  return path.join(projectRoot, AUDIT_RELATIVE_PATH);
}

function lastAuditRecord(auditPath: string): AuditChainRecord | undefined {
  if (!existsSync(auditPath)) return undefined;
  const lines = readFileSync(auditPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return undefined;
  try {
    return JSON.parse(lines[lines.length - 1]) as AuditChainRecord;
  } catch {
    throw new Error(`audit chain is corrupted: ${auditPath}`);
  }
}
