import type {
  AgentAskCommand,
  AgentDebugCommand,
  AgentImplementCommand,
  AgentVerifyCommand,
  AgentReviewCommand,
  AgentConfigCommand,
  BuildCommand,
  CliCommand,
  DoctorCommand,
  GlobalOptions,
  InitCommand,
  KbAddCommand,
  KbClearCommand,
  KbExportManifestCommand,
  KbImportManifestCommand,
  KbListCommand,
  KbRemoveCommand,
  KbSearchCommand,
  ParsedInvocation,
  ReportGenerateCommand,
  RunQemuCommand,
  RunHardwareCommand,
  SpecLintCommand,
  SubmitPackCommand,
  VerifyCommand,
} from "./types.ts";

const VALUE_FLAGS = new Set([
  "--project-root",
  "--progress",
  "--provider",
  "--model",
  "--base-url",
  "--auth-env",
  "--embedding-provider",
  "--embedding-model",
  "--embedding-base-url",
  "--embedding-auth-env",
  "--source-kind",
  "--stage",
  "--title",
  "--manifest",
  "--out",
  "--branch",
  "--tag",
]);

const RETIRED_TOP_LEVEL_COMMANDS = new Set([
  "login",
  "logout",
  "whoami",
  "pipeline",
  "project",
  "serve",
  "stage",
  "toolchain",
  "arch",
  "test",
  "trace",
  "debug",
  "ledger",
  "seed",
]);

export function parseArgs(argv: string[]): ParsedInvocation {
  const input = argv.slice(2);

  const global: GlobalOptions = {
    projectRoot: process.cwd(),
    json: false,
    verbose: false,
    progress: "auto",
  };

  const commandTokens: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const arg = input[i];
    if (arg === "--project-root") {
      global.projectRoot = resolveRequiredValue(input, i, arg);
      i++;
      continue;
    }
    if (arg.startsWith("--project-root=")) {
      global.projectRoot = arg.slice("--project-root=".length);
      continue;
    }
    if (arg === "--json") {
      global.json = true;
      continue;
    }
    if (arg === "-v" || arg === "--verbose") {
      global.verbose = true;
      continue;
    }
    if (arg === "--progress") {
      global.progress = parseProgressMode(resolveRequiredValue(input, i, arg));
      i++;
      continue;
    }
    if (arg.startsWith("--progress=")) {
      global.progress = parseProgressMode(arg.slice("--progress=".length));
      continue;
    }
    if (arg === "--agent-session" || arg.startsWith("--agent-session=")
      || arg === "--report" || arg.startsWith("--report=")
      || arg === "--evidence-dir" || arg.startsWith("--evidence-dir=")) {
      throw new Error(`${arg.split("=")[0]} was removed from the student CLI`);
    }
    if (arg === "-h" || arg === "--help") {
      commandTokens.push(arg);
      continue;
    }
    commandTokens.push(arg);
  }

  if (commandTokens.length === 0 || commandTokens[0] === "-h" || commandTokens[0] === "--help") {
    return { global, command: { kind: "help", topic: undefined } };
  }

  if (commandTokens[0] === "help") {
    return { global, command: { kind: "help", topic: commandTokens.slice(1).join(" ") || undefined } };
  }

  const helpIndex = commandTokens.findIndex((arg) => arg === "-h" || arg === "--help");
  if (helpIndex >= 0) {
    return { global, command: { kind: "help", topic: commandTokens.slice(0, helpIndex).join(" ") || undefined } };
  }

  const command = parseCommand(commandTokens, global);
  return { global, command };
}

function parseProgressMode(value: string): GlobalOptions["progress"] {
  if (value === "auto" || value === "always" || value === "never") {
    return value;
  }
  throw new Error("--progress must be one of: auto, always, never");
}

function parseCommand(tokens: string[], global: GlobalOptions): CliCommand {
  const [command, ...rest] = tokens;
  void global;

  if (RETIRED_TOP_LEVEL_COMMANDS.has(command)) {
    throw new Error(`${command} was removed from the student CLI`);
  }

  if (command === "init") {
    if (rest.length > 0) throw new Error("vos init accepts no command-specific options");
    return { kind: "init" } satisfies InitCommand;
  }

  if (command === "doctor") {
    if (rest.length > 0) throw new Error("vos doctor accepts no command-specific options");
    return { kind: "doctor" } satisfies DoctorCommand;
  }

  if (command === "spec") {
    const second = rest[0];
    if (second === "check") {
      throw new Error("spec check was removed; use `vos spec lint [target]`");
    }
    if (second === "lint") {
      let target: string | undefined;
      for (const arg of rest.slice(1)) {
        if (arg.startsWith("-")) throw new Error(`unknown flag for spec lint: ${arg}`);
        if (target) throw new Error("spec lint accepts at most one target");
        target = arg;
      }
      return { kind: "spec_lint", target } satisfies SpecLintCommand;
    }
    if (second === "normalize" || second === "check-consistency" || second === "patch") {
      throw new Error(`spec ${second} was removed from the student CLI; use \`vos spec lint [target]\``);
    }
    throw new Error("unknown command: spec");
  }

  if (command === "build") {
    if (rest[0] === "generate") {
      throw new Error("build generate was removed from the student CLI; use `vos agent implement <module>`");
    }
    if (rest.length > 0) throw new Error("vos build accepts no command-specific options");
    return { kind: "build", dryRun: false } satisfies BuildCommand;
  }

  if (command === "run") {
    const second = rest[0];
    if (second === "hardware") {
      if (rest.length > 1) throw new Error("vos run hardware accepts no command-specific options");
      return { kind: "run_hardware", dryRun: false } satisfies RunHardwareCommand;
    }
    if (second !== "qemu") {
      throw new Error("only `run qemu` is supported");
    }
    if (rest.length > 1) throw new Error("vos run qemu accepts no command-specific options");
    return { kind: "run_qemu", dryRun: false } satisfies RunQemuCommand;
  }

  if (command === "verify") {
    if (rest.some((arg) => arg !== "--hidden") || rest.filter((arg) => arg === "--hidden").length > 1) {
      throw new Error("vos verify accepts only --hidden");
    }
    return {
      kind: "verify",
      scope: "public",
      target: undefined,
      dryRun: false,
      staffPolicy: undefined,
      ...(rest.includes("--hidden") ? { hidden: true } : {}),
    } satisfies VerifyCommand;
  }

  if (command === "report") {
    const second = rest[0];
    if (!second) return { kind: "report_generate", final: false } satisfies ReportGenerateCommand;
    throw new Error("report generate was removed; use `vos report`");
  }

  if (command === "submit") {
    const second = rest[0];
    if (!second) return { kind: "submit_pack" } satisfies SubmitPackCommand;
    throw new Error("submit pack was removed; use `vos submit`");
  }

  if (command === "kb") {
    const second = rest[0];
    if (second === "add") {
      const source = rest[1];
      let sourceKind: KbAddCommand["sourceKind"] = "project";
      let stage: string | undefined;
      let title: string | undefined;
      let manifestPath: string | undefined;
      let recursive = false;
      let branch: string | undefined;
      let tag: string | undefined;
      if (!source || source.startsWith("-")) throw new Error("kb add requires <path-or-url>");
      for (let i = 2; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--source-kind") {
          sourceKind = parseKbSourceKind(resolveRequiredValue(rest, i, arg));
          i++;
          continue;
        }
        if (arg.startsWith("--source-kind=")) {
          sourceKind = parseKbSourceKind(arg.slice("--source-kind=".length));
          continue;
        }
        if (arg === "--stage") {
          stage = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--stage=")) {
          stage = arg.slice("--stage=".length);
          continue;
        }
        if (arg === "--title") {
          title = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--title=")) {
          title = arg.slice("--title=".length);
          continue;
        }
        if (arg === "--manifest") {
          manifestPath = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--manifest=")) {
          manifestPath = arg.slice("--manifest=".length);
          continue;
        }
        if (arg === "--recursive") {
          recursive = true;
          continue;
        }
        if (arg === "--branch") {
          branch = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--branch=")) {
          branch = arg.slice("--branch=".length);
          continue;
        }
        if (arg === "--tag") {
          tag = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--tag=")) {
          tag = arg.slice("--tag=".length);
          continue;
        }
        throw new Error(`unknown flag for kb add: ${arg}`);
      }
      return { kind: "kb_add", source, sourceKind, stage, title, recursive, manifestPath, branch, tag } satisfies KbAddCommand;
    }
    if (second === "list") {
      if (rest.length > 1) throw new Error("kb list accepts no command-specific options");
      return { kind: "kb_list" } satisfies KbListCommand;
    }
    if (second === "search") {
      const query = rest.slice(1).join(" ").trim();
      if (!query) throw new Error("kb search requires <query>");
      return { kind: "kb_search", query } satisfies KbSearchCommand;
    }
    if (second === "remove") {
      const id = rest[1];
      if (!id || id.startsWith("-")) throw new Error("kb remove requires <source-id>");
      if (rest.length > 2) throw new Error("kb remove accepts exactly one source ID");
      return { kind: "kb_remove", id } satisfies KbRemoveCommand;
    }
    if (second === "clear") {
      if (rest.length > 1) throw new Error("kb clear accepts no command-specific options");
      return { kind: "kb_clear" } satisfies KbClearCommand;
    }
    if (second === "export-manifest") {
      let outPath: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--out") {
          outPath = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--out=")) {
          outPath = arg.slice("--out=".length);
          continue;
        }
        throw new Error(`unknown flag for kb export-manifest: ${arg}`);
      }
      return { kind: "kb_export_manifest", outPath } satisfies KbExportManifestCommand;
    }
    if (second === "import-manifest") {
      const manifestPath = rest[1];
      if (!manifestPath || manifestPath.startsWith("-")) throw new Error("kb import-manifest requires <path>");
      if (rest.length > 2) throw new Error("kb import-manifest accepts exactly one path");
      return { kind: "kb_import_manifest", manifestPath } satisfies KbImportManifestCommand;
    }
    throw new Error(`unknown kb subcommand: ${second}`);
  }

  if (command === "agent") {
    const second = rest[0];
    if (["serve", "context", "plan", "generate", "apply-patch", "validate-generated", "log"].includes(second ?? "")) {
      throw new Error(`agent ${second} was removed from the student CLI`);
    }
    if (second === "config") {
      let provider: AgentConfigCommand["provider"];
      let model: string | undefined;
      let baseUrl: string | undefined;
      let authEnv: string | undefined;
      let embeddingProvider: AgentConfigCommand["embeddingProvider"];
      let embeddingModel: string | undefined;
      let embeddingBaseUrl: string | undefined;
      let embeddingAuthEnv: string | undefined;
      let configureEmbedding: boolean | undefined;
      let embeddingChoiceSeen = false;
      let show = false;
      let reset = false;
      let check = false;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        const valueFlag = (name: string): string | undefined => {
          if (arg === name) {
            const value = resolveRequiredValue(rest, i, arg);
            i++;
            return value;
          }
          return arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;
        };
        const providerValue = valueFlag("--provider");
        if (providerValue !== undefined) { provider = parseAgentProvider(providerValue); continue; }
        const modelValue = valueFlag("--model");
        if (modelValue !== undefined) { model = modelValue; continue; }
        const baseUrlValue = valueFlag("--base-url");
        if (baseUrlValue !== undefined) { baseUrl = baseUrlValue; continue; }
        const authEnvValue = valueFlag("--auth-env");
        if (authEnvValue !== undefined) { authEnv = authEnvValue; continue; }
        const embeddingProviderValue = valueFlag("--embedding-provider");
        if (embeddingProviderValue !== undefined) { embeddingProvider = parseAgentEmbeddingProvider(embeddingProviderValue); configureEmbedding = true; continue; }
        const embeddingModelValue = valueFlag("--embedding-model");
        if (embeddingModelValue !== undefined) { embeddingModel = embeddingModelValue; configureEmbedding = true; continue; }
        const embeddingBaseUrlValue = valueFlag("--embedding-base-url");
        if (embeddingBaseUrlValue !== undefined) { embeddingBaseUrl = embeddingBaseUrlValue; configureEmbedding = true; continue; }
        const embeddingAuthEnvValue = valueFlag("--embedding-auth-env");
        if (embeddingAuthEnvValue !== undefined) { embeddingAuthEnv = embeddingAuthEnvValue; configureEmbedding = true; continue; }
        if (arg === "--with-embedding" || arg === "--without-embedding") {
          const next = arg === "--with-embedding";
          if (embeddingChoiceSeen && configureEmbedding !== next) {
            throw new Error("agent config cannot combine --with-embedding and --without-embedding");
          }
          embeddingChoiceSeen = true;
          configureEmbedding = next;
          continue;
        }
        if (arg === "--show") { show = true; continue; }
        if (arg === "--reset") { reset = true; continue; }
        if (arg === "--check") { check = true; continue; }
        throw new Error(`unknown flag for agent config: ${arg}`);
      }
      const modes = [show, reset, check].filter(Boolean).length;
      if (modes > 1) throw new Error("agent config accepts only one of --show, --reset, or --check");
      const hasValues = Boolean(provider || model || baseUrl || authEnv || embeddingProvider || embeddingModel || embeddingBaseUrl || embeddingAuthEnv || configureEmbedding !== undefined);
      if (modes > 0 && hasValues) throw new Error("agent config --show/--reset/--check cannot be combined with configuration flags");
      return {
        kind: "agent_config", provider, model, baseUrl, authEnv,
        embeddingProvider, embeddingModel, embeddingBaseUrl, embeddingAuthEnv,
        configureEmbedding, show, reset, check,
      } satisfies AgentConfigCommand;
    }
    if (second === "design") {
      throw new Error("agent design was removed; discuss choices with `vos agent ask`, then handwrite and review the DesignSpec");
    }
    if (second === "spec") {
      throw new Error("agent spec was removed; handwrite the Spec, run `vos spec lint`, then use `vos agent review`");
    }
    if (second === "implement") {
      const module = rest[1];
      if (!module || module.startsWith("-")) throw new Error("agent implement requires <module>");
      const tail = rest.slice(2);
      if (tail.length > 0) throw new Error("agent implement accepts exactly one module");
      return { kind: "agent_implement", module } satisfies AgentImplementCommand;
    }
    if (second === "verify") {
      if (rest.length > 1) throw new Error("agent verify accepts no command-specific options");
      return { kind: "agent_verify" } satisfies AgentVerifyCommand;
    }
    if (second === "ask") {
      const question = rest.slice(1).filter((arg) => !isInteractiveDisplayFlag(arg)).join(" ").trim() || undefined;
      const interactive = rest.slice(1).some(isInteractiveDisplayFlag) || !question;
      if (rest.slice(1).some((arg) => arg.startsWith("-") && !isInteractiveDisplayFlag(arg))) {
        throw new Error("agent ask accepts a question and optional --interactive");
      }
      return { kind: "agent_ask", question, interactive } satisfies AgentAskCommand;
    }
    if (second === "review") {
      const positional = rest.slice(1).filter((arg) => !isInteractiveDisplayFlag(arg));
      if (positional.length > 1) throw new Error("agent review accepts at most one Spec ID, path, design, or all target");
      if (positional[0]?.startsWith("-")) throw new Error(`unknown flag for agent review: ${positional[0]}`);
      return { kind: "agent_review", target: positional[0], ...(rest.some(isInteractiveDisplayFlag) ? { display: true } : {}) } satisfies AgentReviewCommand;
    }
    if (second === "debug") {
      if (rest.length > 1) throw new Error("agent debug accepts no command-specific options");
      return { kind: "agent_debug", keepWorktree: false } satisfies AgentDebugCommand;
    }
    if (second === "review-spec") {
      throw new Error("agent review-spec was removed; use `vos agent review [target] [-i]`");
    }
    throw new Error(`unknown agent subcommand: ${second}`);
  }

  if (command === "help") {
    return { kind: "help", topic: rest[0] };
  }

  throw new Error(`unknown command: ${command}`);
}

function parseAgentProvider(value: string): AgentConfigCommand["provider"] {
  const normalized = value.trim().toLowerCase();
  const providers = ["anthropic", "openai", "openai-compatible", "deepseek", "ollama"];
  if (!providers.includes(normalized)) throw new Error(`--provider must be one of: ${providers.join(", ")}`);
  return normalized as AgentConfigCommand["provider"];
}

function parseAgentEmbeddingProvider(value: string): AgentConfigCommand["embeddingProvider"] {
  const normalized = value.trim().toLowerCase();
  const providers = ["openai", "openai-compatible"];
  if (!providers.includes(normalized)) throw new Error(`--embedding-provider must be one of: ${providers.join(", ")}`);
  return normalized as AgentConfigCommand["embeddingProvider"];
}

function parseKbSourceKind(value: string): KbAddCommand["sourceKind"] {
  if (value === "course" || value === "project" || value === "external") return value;
  throw new Error("--source-kind must be one of: course, project, external");
}

function isInteractiveDisplayFlag(value: string): boolean {
  return value === "-i" || value === "--interactive";
}

function resolveRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-") || VALUE_FLAGS.has(value)) {
    throw new Error(`error: ${flag} requires a value`);
  }
  return value;
}
