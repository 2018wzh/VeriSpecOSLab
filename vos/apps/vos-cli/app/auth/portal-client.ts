import { CliError } from "../errors.ts";
import type { PolicySnapshot, PortalUserSummary } from "../types.ts";
import { normalizePortalUrl } from "./store.ts";

export interface PortalClient {
  getMe(portalUrl: string, token: string): Promise<PortalUserSummary>;
  getProjectPolicy(portalUrl: string, projectId: string, token: string): Promise<PolicySnapshot>;
}

export class HttpPortalClient implements PortalClient {
  async getMe(portalUrl: string, token: string): Promise<PortalUserSummary> {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/auth/me`, {
      headers: authHeaders(token),
    });
    if (!response.ok) {
      throw portalError(response.status, "token_invalid");
    }
    const payload = await response.json() as { user?: unknown } | unknown;
    const user = normalizeUser((payload as { user?: unknown }).user ?? payload);
    if (!user) {
      throw new CliError("policy_blocked: invalid Portal user response", "policy_blocked", {
        reason: "policy_unavailable",
      });
    }
    return user;
  }

  async getProjectPolicy(portalUrl: string, projectId: string, token: string): Promise<PolicySnapshot> {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/projects/${encodeURIComponent(projectId)}/vos-policy`, {
      headers: authHeaders(token),
    });
    if (!response.ok) {
      throw portalError(response.status, response.status === 404 ? "policy_unavailable" : "token_invalid");
    }
    const payload = await response.json() as { policy?: unknown } | unknown;
    const policy = normalizePolicySnapshot((payload as { policy?: unknown }).policy ?? payload);
    if (!policy) {
      throw new CliError("policy_blocked: invalid Portal policy response", "policy_blocked", {
        reason: "policy_unavailable",
      });
    }
    if (policy.projectId !== projectId) {
      throw new CliError("policy_blocked: Portal policy project mismatch", "policy_blocked", {
        reason: "policy_unavailable",
        expected_project_id: projectId,
        actual_project_id: policy.projectId,
      });
    }
    return policy;
  }
}

export const defaultPortalClient = new HttpPortalClient();

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
}

function portalError(status: number, reason: string): CliError {
  return new CliError(`policy_blocked: ${reason}`, "policy_blocked", { reason, status });
}

function normalizeUser(raw: unknown): PortalUserSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const id = stringValue(obj.id) ?? stringValue(obj.user_id);
  if (!id) return undefined;
  return {
    id,
    role: stringValue(obj.role),
    username: stringValue(obj.username),
    email: stringValue(obj.email),
  };
}

function normalizePolicySnapshot(raw: unknown): PolicySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const ref = stringValue(obj.ref) ?? stringValue(obj.id) ?? stringValue(obj.policy_snapshot_ref);
  const projectId = stringValue(obj.project_id) ?? stringValue(obj.projectId);
  if (!ref || !projectId) return undefined;
  return {
    ref,
    projectId,
    allowedCommands: stringArray(obj.allowed_commands) ?? stringArray(obj.allowedCommands) ?? [],
    allowedPaths: stringArray(obj.allowed_paths) ?? stringArray(obj.allowedPaths) ?? [],
    visibilityScope: obj.visibility_scope === "agent-only" || obj.visibilityScope === "agent-only"
      ? "agent-only"
      : "public",
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
