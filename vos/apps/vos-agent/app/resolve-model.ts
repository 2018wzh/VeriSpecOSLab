import { resolveModeDefinition, type Config, type ReasoningEffort } from "./config.ts";

export interface ModelSelectionArgs {
  mode?: string;
  model?: string;
}

export interface StoredThreadModelSelectionArgs extends ModelSelectionArgs {
  kind: string;
  threadId?: string;
}

export interface ActiveModelSettings {
  model: string;
  mode?: string;
  reasoningEffort?: ReasoningEffort;
}

/**
 * Resolve the model that this invocation should use.
 *
 * Precedence (first match wins):
 *   1. CLI `--model <id>`        explicit raw override
 *   2. CLI `-m|--mode <name>`    resolves against Config.modes
 *   3. Config.defaultMode        the built-in default ("smart")
 */
export function resolveActiveModel(config: Config, args: ModelSelectionArgs): string {
  return resolveActiveModelSettings(config, args).model;
}

export function resolveActiveModelSettings(
  config: Config,
  args: ModelSelectionArgs,
): ActiveModelSettings {
  if (args.model) return { model: args.model };
  const mode = args.mode ?? config.defaultMode;
  const def = resolveModeDefinition(config, mode);
  return {
    model: def.model,
    mode,
    ...(def.reasoningEffort ? { reasoningEffort: def.reasoningEffort } : {}),
  };
}

export function shouldUseStoredThreadModel(args: StoredThreadModelSelectionArgs): boolean {
  return (
    (args.kind === "execute" || args.kind === "interactive") &&
    Boolean(args.threadId) &&
    !args.model &&
    !args.mode
  );
}
