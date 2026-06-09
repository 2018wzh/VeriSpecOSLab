import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd: string;
}

export interface PluginManifest {
  name: string;
  path: string;
  mcpServers: McpServerConfig[];
}

export interface LoadPluginManifestsOptions {
  workspaceRoot: string;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function loadPluginManifests(
  opts: LoadPluginManifestsOptions,
): PluginManifest[] {
  const workspaceRoot = resolve(opts.workspaceRoot);
  const pluginDir = join(workspaceRoot, ".agents", "plugins");
  if (!existsSync(pluginDir)) return [];

  const manifests: PluginManifest[] = [];
  const entries = readdirSync(pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(pluginDir, entry.name);
    manifests.push(validatePluginManifest(readJson(path), path, workspaceRoot));
  }
  return manifests;
}

export function pluginMcpServers(
  manifests: readonly PluginManifest[],
): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    for (const server of manifest.mcpServers) {
      const normalizedName = server.name.toLowerCase();
      if (seen.has(normalizedName)) {
        throw new Error(`duplicate MCP server name "${server.name}" in plugin manifests`);
      }
      seen.add(normalizedName);
      servers.push(server);
    }
  }
  return servers;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Error loading plugin manifest "${path}": ${(e as Error).message}`);
  }
}

function validatePluginManifest(
  value: unknown,
  path: string,
  workspaceRoot: string,
): PluginManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "manifest must be an object");
  }
  const raw = value as { name?: unknown; mcpServers?: unknown };
  const fallbackName = path.slice(path.lastIndexOf("/") + 1, -".json".length);
  const name = raw.name === undefined
    ? fallbackName
    : requireName(raw.name, path, "name");
  validateName(name, path, "name");

  const mcpServers = raw.mcpServers === undefined
    ? []
    : validateMcpServers(raw.mcpServers, path, workspaceRoot);

  return { name, path, mcpServers };
}

function validateMcpServers(
  value: unknown,
  path: string,
  workspaceRoot: string,
): McpServerConfig[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "mcpServers must be an object");
  }
  const servers: McpServerConfig[] = [];
  for (const [name, server] of Object.entries(value)) {
    validateName(name, path, `mcpServers.${name}`);
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      throw invalid(path, `mcpServers.${name} must be an object`);
    }
    const raw = server as {
      command?: unknown;
      args?: unknown;
      env?: unknown;
      cwd?: unknown;
    };
    servers.push({
      name,
      command: requireString(raw.command, path, `mcpServers.${name}.command`),
      ...(raw.args !== undefined ? { args: requireStringArray(raw.args, path, `mcpServers.${name}.args`) } : {}),
      ...(raw.env !== undefined ? { env: requireStringMap(raw.env, path, `mcpServers.${name}.env`) } : {}),
      cwd: raw.cwd === undefined
        ? workspaceRoot
        : resolve(workspaceRoot, requireString(raw.cwd, path, `mcpServers.${name}.cwd`)),
    });
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

function requireName(value: unknown, path: string, settingPath: string): string {
  const name = requireString(value, path, settingPath);
  validateName(name, path, settingPath);
  return name;
}

function validateName(name: string, path: string, settingPath: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw invalid(path, `${settingPath} must match ${NAME_PATTERN}`);
  }
}

function requireString(value: unknown, path: string, settingPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, `${settingPath} must be a non-empty string`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, path: string, settingPath: string): string[] {
  if (!Array.isArray(value)) {
    throw invalid(path, `${settingPath} must be an array`);
  }
  return value.map((item, index) =>
    requireRawString(item, path, `${settingPath}[${index}]`)
  );
}

function requireStringMap(value: unknown, path: string, settingPath: string): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, `${settingPath} must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = requireRawString(item, path, `${settingPath}.${key}`);
  }
  return result;
}

function requireRawString(value: unknown, path: string, settingPath: string): string {
  if (typeof value !== "string") {
    throw invalid(path, `${settingPath} must be a string`);
  }
  return value;
}

function invalid(path: string, detail: string): Error {
  return new Error(`invalid plugin manifest ${path}: ${detail}`);
}
