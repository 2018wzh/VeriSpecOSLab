import { randomUUID } from "node:crypto";
import type {
  AgentAuditRecord,
  EvidenceRecord,
  EvidenceRequirement,
  KbSource,
  PortalStore,
  Project,
  StageGate,
  User,
} from "./data.ts";

export class PortalApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly type = "portal_error",
  ) {
    super(message);
  }
}

export function portalCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(request: Request): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new PortalApiError(400, "request body must be JSON", "bad_request");
  }
  const object = asObject(value);
  if (!object) throw new PortalApiError(400, "request body must be a JSON object", "bad_request");
  return object;
}

export function userFromRequest(request: Request, store: PortalStore): User {
  const token = bearerToken(request);
  if (!token) throw new PortalApiError(401, "missing bearer token", "unauthorized");
  return store.userForToken(token);
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("Authorization") ?? request.headers.get("authorization");
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

export function portalJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(deepClone(body)), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...portalCorsHeaders(),
    },
  });
}

export function requireStaff(actor: User): void {
  if (!isStaff(actor)) {
    throw new PortalApiError(403, "staff access required", "forbidden");
  }
}

export function requireProjectAccess(actor: User, project: Project): void {
  if (!isStaff(actor) && project.student_user_id !== actor.id) {
    throw new PortalApiError(403, "project access denied", "forbidden");
  }
}

export function isStaff(user: User): boolean {
  return user.role === "admin" || user.role === "teacher" || user.role === "ta";
}

export function sourceKind(value: string | undefined): KbSource["source_kind"] {
  return value === "course" || value === "external" ? value : "project";
}

export function publicUser(user: User & { password: string }): User {
  const { password: _password, ...rest } = user;
  return rest;
}

export function missing(kind: string, idValue: string): PortalApiError {
  return new PortalApiError(404, `${kind} ${idValue} not found`, "not_found");
}

export function removeById<T extends { id: string }>(items: T[], idValue: string, kind: string): T[] {
  if (!items.some((item) => item.id === idValue)) throw missing(kind, idValue);
  return items.filter((item) => item.id !== idValue);
}

export function missingEvidence(stage: StageGate, evidence: EvidenceRecord[]): EvidenceRequirement[] {
  return stage.config.required_evidence.filter((required) => !evidence.some((record) =>
    record.suite === required.suite &&
    record.case_name === required.case_name &&
    record.result === required.required_result
  ));
}

export function normalizeStageConfig(input: JsonObject): StageGate["config"] {
  const evidence = Array.isArray(input.required_evidence)
    ? input.required_evidence.flatMap((item) => {
      const object = asObject(item);
      if (!object) return [];
      const suite = optionalString(object, "suite");
      const caseName = optionalString(object, "case_name");
      const requiredResult = optionalString(object, "required_result");
      if (!suite || !caseName || !isEvidenceResult(requiredResult)) return [];
      return [{ suite, case_name: caseName, required_result: requiredResult }];
    })
    : [];
  const artifacts = Array.isArray(input.required_artifacts)
    ? input.required_artifacts.filter((item): item is string => typeof item === "string")
    : [];
  return {
    required_artifacts: artifacts,
    required_evidence: evidence,
    manual_review_required: typeof input.manual_review_required === "boolean"
      ? input.manual_review_required
      : false,
    visibility_scope: optionalString(input, "visibility_scope"),
  };
}

export function requiredString(body: JsonObject, key: string): string {
  const value = optionalString(body, key);
  if (!value) throw new PortalApiError(400, `"${key}" must be a non-empty string`, "bad_request");
  return value;
}

export function optionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalNumber(body: JsonObject, key: string): number | undefined {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function numberValue(body: JsonObject, key: string, fallback: number): number {
  return optionalNumber(body, key) ?? fallback;
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function sorted<T>(items: T[], key: (item: T) => string | number): T[] {
  return [...items].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return typeof leftKey === "number" && typeof rightKey === "number"
      ? leftKey - rightKey
      : String(leftKey).localeCompare(String(rightKey));
  });
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function demoToken(username: string): string {
  return `demo-${username}-${randomUUID()}`;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function summarize(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= 220 ? compact : `${compact.slice(0, 217)}...`;
}

export function riskLevel(flags: readonly string[]): AgentAuditRecord["risk_level"] {
  if (flags.length === 0) return "low";
  if (flags.some((flag) =>
    flag.includes("hidden_context") ||
    flag.includes("test_or_checker_bypass") ||
    flag.includes("unsafe_tool")
  )) {
    return "critical";
  }
  if (flags.some((flag) =>
    flag.includes("policy") ||
    flag.includes("unbound") ||
    flag.includes("large_patch")
  )) {
    return "high";
  }
  return "medium";
}

export function isEvidenceResult(value: string | undefined): value is "pass" | "fail" | "error" | "skipped" {
  return value === "pass" || value === "fail" || value === "error" || value === "skipped";
}
