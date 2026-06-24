import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PortalUserSummary } from "../types.ts";

export interface AuthStoreEntry {
  portalUrl: string;
  token: string;
  user?: PortalUserSummary;
  updatedAt: string;
  lastCheckedAt?: string;
}

export interface AuthStore {
  version: 1;
  portals: Record<string, AuthStoreEntry>;
}

export function authStorePath(): string {
  if (process.env.VOS_AUTH_STORE) {
    return path.resolve(process.env.VOS_AUTH_STORE);
  }
  const base = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), ".config");
  return path.join(base, "vos", "auth.json");
}

export async function loadAuthStore(): Promise<AuthStore> {
  const storePath = authStorePath();
  if (!existsSync(storePath)) {
    return { version: 1, portals: {} };
  }
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<AuthStore>;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !parsed.portals) {
      return { version: 1, portals: {} };
    }
    return {
      version: 1,
      portals: parsed.portals as Record<string, AuthStoreEntry>,
    };
  } catch {
    return { version: 1, portals: {} };
  }
}

export async function saveToken(params: {
  portalUrl: string;
  token: string;
  user?: PortalUserSummary;
}): Promise<AuthStoreEntry> {
  const store = await loadAuthStore();
  const portalUrl = normalizePortalUrl(params.portalUrl);
  const entry: AuthStoreEntry = {
    portalUrl,
    token: params.token,
    user: params.user,
    updatedAt: new Date().toISOString(),
  };
  store.portals[portalUrl] = entry;
  await writeAuthStore(store);
  return entry;
}

export async function updateStoredUser(portalUrl: string, user: PortalUserSummary): Promise<void> {
  const normalized = normalizePortalUrl(portalUrl);
  const store = await loadAuthStore();
  const entry = store.portals[normalized];
  if (!entry) return;
  store.portals[normalized] = {
    ...entry,
    user,
    lastCheckedAt: new Date().toISOString(),
  };
  await writeAuthStore(store);
}

export async function getToken(portalUrl: string): Promise<AuthStoreEntry | undefined> {
  const store = await loadAuthStore();
  return store.portals[normalizePortalUrl(portalUrl)];
}

export async function removeToken(portalUrl: string): Promise<boolean> {
  const normalized = normalizePortalUrl(portalUrl);
  const store = await loadAuthStore();
  const existed = Boolean(store.portals[normalized]);
  delete store.portals[normalized];
  if (Object.keys(store.portals).length === 0 && existsSync(authStorePath())) {
    await rm(authStorePath(), { force: true });
    return existed;
  }
  await writeAuthStore(store);
  return existed;
}

export function normalizePortalUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function writeAuthStore(store: AuthStore): Promise<void> {
  const storePath = authStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}
