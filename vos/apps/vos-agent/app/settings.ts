import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isReasoningEffort, type ReasoningEffort } from "./config.ts";

export interface SettingsModeDefinition {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface Settings {
  defaultMode?: string;
  modes: Record<string, SettingsModeDefinition>;
  disabledTools: string[];
}

export interface SettingsInput {
  defaultMode?: string;
  modes?: Record<string, SettingsModeDefinition>;
  disabledTools?: readonly string[];
}

export interface LoadSettingsOptions {
  /** User settings directory. Defaults to VOS_AGENT_HOME or ~/.vos-agent. */
  stateDir?: string;
  /** Workspace root. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Environment map used only for default stateDir resolution. */
  env?: Record<string, string | undefined>;
}

export function loadSettings(opts: LoadSettingsOptions = {}): Settings {
  const stateDir = resolve(opts.stateDir ?? defaultStateDir(opts.env));
  const workspaceRoot = resolve(opts.workspaceRoot ?? process.cwd());
  const user = readSettingsFile(join(stateDir, "settings.json"));
  const workspace = readSettingsFile(join(workspaceRoot, ".vos", "agent", "settings.json"));
  return mergeSettings(user, workspace);
}

export function defaultStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return resolve(env.VOS_AGENT_HOME?.trim() || env.STARS_HOME?.trim() || join(homedir(), ".vos-agent"));
}

function readSettingsFile(path: string): Settings {
  if (!existsSync(path)) return emptySettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Error loading settings "${path}": ${(e as Error).message}`);
  }
  return validateSettings(parsed, path);
}

function validateSettings(value: unknown, path: string): Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "settings must be a JSON object");
  }
  const raw = value as {
    defaultMode?: unknown;
    modes?: unknown;
    tools?: unknown;
  };
  const settings = emptySettings();

  if (raw.defaultMode !== undefined) {
    settings.defaultMode = requireNonEmptyString(raw.defaultMode, path, "defaultMode");
  }

  if (raw.modes !== undefined) {
    if (!raw.modes || typeof raw.modes !== "object" || Array.isArray(raw.modes)) {
      throw invalid(path, "modes must be an object");
    }
    for (const [name, modeValue] of Object.entries(raw.modes)) {
      if (name.trim().length === 0) {
        throw invalid(path, "modes must not contain an empty mode name");
      }
      if (!modeValue || typeof modeValue !== "object" || Array.isArray(modeValue)) {
        throw invalid(path, `modes.${name} must be an object`);
      }
      const rawMode = modeValue as { model?: unknown; reasoningEffort?: unknown };
      const mode: SettingsModeDefinition = {};
      if (rawMode.model !== undefined) {
        mode.model = requireNonEmptyString(rawMode.model, path, `modes.${name}.model`);
      }
      if (rawMode.reasoningEffort !== undefined) {
        const effort = requireNonEmptyString(
          rawMode.reasoningEffort,
          path,
          `modes.${name}.reasoningEffort`,
        );
        if (!isReasoningEffort(effort)) {
          throw invalid(path, `modes.${name}.reasoningEffort is invalid`);
        }
        mode.reasoningEffort = effort;
      }
      settings.modes[name] = mode;
    }
  }

  if (raw.tools !== undefined) {
    if (!raw.tools || typeof raw.tools !== "object" || Array.isArray(raw.tools)) {
      throw invalid(path, "tools must be an object");
    }
    const rawTools = raw.tools as { disabled?: unknown };
    if (rawTools.disabled !== undefined) {
      if (!Array.isArray(rawTools.disabled)) {
        throw invalid(path, "tools.disabled must be an array");
      }
      settings.disabledTools = rawTools.disabled.map((tool, index) =>
        requireNonEmptyString(tool, path, `tools.disabled[${index}]`)
      );
    }
  }

  settings.disabledTools = uniqueStrings(settings.disabledTools);
  return settings;
}

function mergeSettings(user: Settings, workspace: Settings): Settings {
  const modes: Record<string, SettingsModeDefinition> = {};
  for (const [name, mode] of Object.entries(user.modes)) {
    modes[name] = { ...mode };
  }
  for (const [name, mode] of Object.entries(workspace.modes)) {
    modes[name] = { ...(modes[name] ?? {}), ...mode };
  }
  return {
    ...(workspace.defaultMode ?? user.defaultMode
      ? { defaultMode: workspace.defaultMode ?? user.defaultMode }
      : {}),
    modes,
    disabledTools: uniqueStrings([
      ...user.disabledTools,
      ...workspace.disabledTools,
    ]),
  };
}

function emptySettings(): Settings {
  return { modes: {}, disabledTools: [] };
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  settingPath: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, `${settingPath} must be a non-empty string`);
  }
  return value.trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function invalid(path: string, detail: string): Error {
  return new Error(`invalid settings ${path}: ${detail}`);
}
