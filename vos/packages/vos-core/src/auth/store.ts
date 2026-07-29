import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { AsyncEntry } from "@napi-rs/keyring";
import type { PortalUserSummary } from "../types.ts";
import { CliError } from "../errors.ts";

const KEYRING_SERVICE = "VeriSpecOSLab VOS";
const KEYRING_ACCOUNT_PREFIX = "auth-store-key-v1";

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

interface EncryptedAuthStore {
  version: 2;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
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
    const disk = JSON.parse(await readFile(storePath, "utf8")) as Record<string, unknown>;
    const parsed = disk.version === 2
      ? JSON.parse(await decryptStore(disk)) as Partial<AuthStore>
      : disk as Partial<AuthStore>;
    const store = validateStore(parsed);
    if (disk.version === 1) {
      await writeAuthStore(store);
    }
    return store;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      `credential store is corrupted: ${error instanceof Error ? error.message : String(error)}`,
      "failed",
      { reason: "credential_store_corrupted", path: storePath },
    );
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
  if (!existed) {
    return false;
  }
  delete store.portals[normalized];
  if (Object.keys(store.portals).length === 0) {
    await deleteAuthKey();
    await rm(authStorePath(), { force: true });
    return existed;
  }
  await writeAuthStore(store);
  return existed;
}

export function normalizePortalUrl(raw: string): string {
  const normalized = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new CliError("Portal URL must be an absolute HTTP(S) URL", "validation_failed");
  }
  if (
    parsed.protocol !== "https:"
    && !(parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"))
  ) {
    throw new CliError("Portal URL must use HTTPS except for localhost", "policy_blocked", {
      reason: "insecure_portal_url",
    });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CliError("Portal URL must not contain credentials, query, or fragment", "validation_failed");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function writeAuthStore(store: AuthStore): Promise<void> {
  const storePath = authStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  const key = await authKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(store), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedAuthStore = {
    version: 2,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  const temporaryPath = `${storePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  try {
    await rename(temporaryPath, storePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function usesExplicitFileStore(): boolean {
  return Boolean(process.env.VOS_AUTH_STORE);
}

function legacyAuthKeyPath(): string {
  return `${authStorePath()}.key`;
}

function keyringEntry(): AsyncEntry {
  const storeIdentity = createHash("sha256").update(authStorePath()).digest("hex").slice(0, 24);
  return new AsyncEntry(KEYRING_SERVICE, `${KEYRING_ACCOUNT_PREFIX}:${storeIdentity}`);
}

async function authKey(): Promise<Buffer> {
  if (usesExplicitFileStore()) {
    return fileAuthKey();
  }

  const entry = keyringEntry();
  try {
    const stored = await entry.getPassword();
    if (stored) {
      return decodeAuthKey(stored);
    }

    const legacyPath = legacyAuthKeyPath();
    const key = existsSync(legacyPath)
      ? decodeAuthKey((await readFile(legacyPath, "utf8")).trim())
      : randomBytes(32);
    await entry.setPassword(key.toString("base64"));
    if (existsSync(legacyPath)) {
      await rm(legacyPath, { force: true });
    }
    return key;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw keyringError("access", error);
  }
}

async function fileAuthKey(): Promise<Buffer> {
  const keyPath = legacyAuthKeyPath();
  if (existsSync(keyPath)) {
    return decodeAuthKey((await readFile(keyPath, "utf8")).trim());
  }
  await mkdir(path.dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  try {
    await writeFile(keyPath, `${key.toString("base64")}\n`, { mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return decodeAuthKey((await readFile(keyPath, "utf8")).trim());
    }
    throw error;
  }
}

async function deleteAuthKey(): Promise<void> {
  if (usesExplicitFileStore()) {
    await rm(legacyAuthKeyPath(), { force: true });
    return;
  }
  try {
    await keyringEntry().deleteCredential();
    await rm(legacyAuthKeyPath(), { force: true });
  } catch (error) {
    throw keyringError("delete", error);
  }
}

function decodeAuthKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new CliError("credential encryption key is invalid", "failed", {
      reason: "credential_key_invalid",
    });
  }
  return key;
}

function keyringError(operation: "access" | "delete", error: unknown): CliError {
  return new CliError(
    `system credential manager ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    "failed",
    { reason: "credential_keyring_unavailable" },
  );
}

async function decryptStore(raw: Record<string, unknown>): Promise<string> {
  if (
    raw.algorithm !== "aes-256-gcm"
    || typeof raw.iv !== "string"
    || typeof raw.tag !== "string"
    || typeof raw.ciphertext !== "string"
  ) {
    throw new Error("invalid encrypted credential envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", await authKey(), Buffer.from(raw.iv, "base64"));
  decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(raw.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function validateStore(parsed: Partial<AuthStore>): AuthStore {
  if (
    !parsed
    || typeof parsed !== "object"
    || parsed.version !== 1
    || !parsed.portals
    || typeof parsed.portals !== "object"
  ) {
    throw new Error("unsupported auth store schema");
  }
  for (const [key, value] of Object.entries(parsed.portals)) {
    if (
      !value
      || typeof value !== "object"
      || typeof value.token !== "string"
      || typeof value.portalUrl !== "string"
      || key !== normalizePortalUrl(value.portalUrl)
    ) {
      throw new Error(`invalid auth entry ${key}`);
    }
  }
  return { version: 1, portals: parsed.portals as Record<string, AuthStoreEntry> };
}
