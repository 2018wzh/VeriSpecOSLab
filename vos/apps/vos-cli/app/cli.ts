import type {
  AgentApplyPatchCommand,
  AgentContextCommand,
  AgentDebugCommand,
  AgentGenerateCommand,
  AgentLogCommand,
  AgentPlanCommand,
  AgentReviewSpecCommand,
  AgentServeCommand,
  AgentValidateGeneratedCommand,
  AgentAskCommand,
  ArchComposeCommand,
  ArchDeriveTestsCommand,
  ArchLintCommand,
  BuildCommand,
  BuildGenerateCommand,
  CliCommand,
  DebugExplainLogCommand,
  DoctorCommand,
  GlobalOptions,
  InitCommand,
  LoginCommand,
  LedgerRecordCommand,
  LogoutCommand,
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
  ServeCommand,
  StageShowCommand,
  SpecCheckConsistencyCommand,
  SpecLintCommand,
  SpecNormalizeCommand,
  SpecPatchApplyCommand,
  SpecPatchLintCommand,
  SubmitPackCommand,
  TestCommand,
  ToolchainLintCommand,
  TraceSyscallCommand,
  VerifyCommand,
  VerifyScope,
  WhoamiCommand,
} from "./types.ts";

const VALUE_FLAGS = new Set([
  "--project-root",
  "--progress",
  "--agent-session",
  "--report",
  "--evidence-dir",
  "--toolchain",
  "--timeout",
  "--ready-pattern",
  "--suite",
  "--target",
  "--task",
  "--scope",
  "--stage",
  "--log",
  "--entry",
  "--host",
  "--port",
  "--portal-url",
  "--project-id",
  "--token",
  "--apply",
  "--build",
  "--run",
  "--no-require-spec",
  "--run-validation",
  "--patch-file",
  "--keep-worktree",
  "--source-kind",
  "--title",
  "--manifest",
  "--out",
]);

export function parseArgs(argv: string[]): ParsedInvocation {
  const input = argv.slice(2);

  const global: GlobalOptions = {
    projectRoot: process.cwd(),
    json: false,
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
    if (arg === "--progress") {
      global.progress = parseProgressMode(resolveRequiredValue(input, i, arg));
      i++;
      continue;
    }
    if (arg.startsWith("--progress=")) {
      global.progress = parseProgressMode(arg.slice("--progress=".length));
      continue;
    }
    if (arg === "--agent-session") {
      global.agentSession = resolveRequiredValue(input, i, arg);
      i++;
      continue;
    }
    if (arg === "--report") {
      global.reportPath = resolveRequiredValue(input, i, arg);
      i++;
      continue;
    }
    if (arg === "--evidence-dir") {
      global.evidenceDir = resolveRequiredValue(input, i, arg);
      i++;
      continue;
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

  const command = parseCommand(commandTokens, global);
  return { global, command };
}

function parseProgressMode(value: string): GlobalOptions["progress"] {
  if (value === "auto" || value === "always" || value === "never") {
    return value;
  }
  throw new Error("--progress must be one of: auto, always, never");
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port requires a valid TCP port");
  }
  return port;
}

function parseCommand(tokens: string[], global: GlobalOptions): CliCommand {
  const [command, ...rest] = tokens;
  void global;

  if (command === "login") {
    let portalUrl: string | undefined;
    let token: string | undefined;
    let tokenStdin = false;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--portal-url") {
        portalUrl = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--portal-url=")) {
        portalUrl = arg.slice("--portal-url=".length);
        continue;
      }
      if (arg === "--token") {
        token = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--token=")) {
        token = arg.slice("--token=".length);
        continue;
      }
      if (arg === "--token-stdin") {
        tokenStdin = true;
        continue;
      }
      throw new Error(`unknown flag for login: ${arg}`);
    }
    if (!portalUrl) {
      throw new Error("login requires --portal-url");
    }
    if (token && tokenStdin) {
      throw new Error("login accepts either --token or --token-stdin, not both");
    }
    return { kind: "login", portalUrl, token, tokenStdin } satisfies LoginCommand;
  }

  if (command === "logout") {
    let portalUrl: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--portal-url") {
        portalUrl = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--portal-url=")) {
        portalUrl = arg.slice("--portal-url=".length);
        continue;
      }
      throw new Error(`unknown flag for logout: ${arg}`);
    }
    return { kind: "logout", portalUrl } satisfies LogoutCommand;
  }

  if (command === "whoami") {
    let portalUrl: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--portal-url") {
        portalUrl = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--portal-url=")) {
        portalUrl = arg.slice("--portal-url=".length);
        continue;
      }
      throw new Error(`unknown flag for whoami: ${arg}`);
    }
    return { kind: "whoami", portalUrl } satisfies WhoamiCommand;
  }

  if (command === "serve") {
    let portalUrl: string | undefined;
    let projectId: string | undefined;
    let host: string | undefined;
    let port: number | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--portal-url") {
        portalUrl = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--portal-url=")) {
        portalUrl = arg.slice("--portal-url=".length);
        continue;
      }
      if (arg === "--project-id") {
        projectId = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--project-id=")) {
        projectId = arg.slice("--project-id=".length);
        continue;
      }
      if (arg === "--host") {
        host = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--host=")) {
        host = arg.slice("--host=".length);
        continue;
      }
      if (arg === "--port") {
        port = parsePort(resolveRequiredValue(rest, i, arg));
        i++;
        continue;
      }
      if (arg.startsWith("--port=")) {
        port = parsePort(arg.slice("--port=".length));
        continue;
      }
      throw new Error(`unknown flag for serve: ${arg}`);
    }
    if (!portalUrl) {
      throw new Error("serve requires --portal-url");
    }
    if (!projectId) {
      throw new Error("serve requires --project-id");
    }
    return { kind: "serve", portalUrl, projectId, host, port } satisfies ServeCommand;
  }

  if (command === "init") {
    return { kind: "init" } satisfies InitCommand;
  }

  if (command === "doctor") {
    return { kind: "doctor" } satisfies DoctorCommand;
  }

  if (command === "stage") {
    const second = rest[0];
    if (second !== "show") {
      throw new Error("unknown command: stage (use: stage show)");
    }
    return { kind: "stage_show" } satisfies StageShowCommand;
  }

  if (command === "toolchain") {
    const second = rest[0];
    if (second !== "lint") {
      throw new Error("unknown command: toolchain (use: toolchain lint)");
    }
    return { kind: "toolchain_lint" } satisfies ToolchainLintCommand;
  }

  if (command === "spec") {
    const second = rest[0];
    if (second === "lint") {
      return { kind: "spec_lint", path: rest[1] } satisfies SpecLintCommand;
    }
    if (second === "normalize") {
      return { kind: "spec_normalize" } satisfies SpecNormalizeCommand;
    }
    if (second === "check-consistency") {
      return { kind: "spec_check_consistency" } satisfies SpecCheckConsistencyCommand;
    }
    if (second === "patch") {
      const sub = rest[1];
      if (sub === "lint") {
        if (rest[2] === "-") {
          throw new Error("spec patch lint requires a SpecPatch YAML path or commit-ish; use `vos agent apply-patch` for unified diffs");
        }
        return { kind: "spec_patch_lint", patchPath: rest[2] } satisfies SpecPatchLintCommand;
      }
      if (sub === "apply") {
        const patchPath = rest[2];
        if (!patchPath || patchPath === "-") {
          throw new Error("spec patch apply requires a SpecPatch YAML path or commit-ish; use `vos agent apply-patch` for unified diffs");
        }
        return { kind: "spec_patch_apply", patchPath } satisfies SpecPatchApplyCommand;
      }
    }
    throw new Error("unknown command: spec");
  }

  if (command === "arch") {
    const second = rest[0];
    if (second === "lint") {
      return { kind: "arch_lint", path: rest[1] } satisfies ArchLintCommand;
    }
    if (second === "compose") {
      return { kind: "arch_compose", path: rest[1] } satisfies ArchComposeCommand;
    }
    if (second === "derive-tests") {
      return { kind: "arch_derive_tests", path: rest[1] } satisfies ArchDeriveTestsCommand;
    }
    throw new Error("unknown command: arch");
  }

  if (command === "build") {
    if (rest[0] === "generate") {
      let agentSession: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--agent-session") {
          agentSession = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--agent-session=")) {
          agentSession = arg.slice("--agent-session=".length);
          continue;
        }
        throw new Error(`unknown flag for build generate: ${arg}`);
      }
      return { kind: "build_generate", agentSession: agentSession ?? global.agentSession } satisfies BuildGenerateCommand;
    }
    let dryRun = false;
    let toolchainPath: string | undefined;
    let variant: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg === "--toolchain") {
        toolchainPath = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--toolchain=")) {
        toolchainPath = arg.slice("--toolchain=".length);
        continue;
      }
      if (arg === "--variant") {
        variant = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--variant=")) {
        variant = arg.slice("--variant=".length);
        continue;
      }
      throw new Error(`unknown flag for build: ${arg}`);
    }
    return { kind: "build", dryRun, toolchainPath, variant } satisfies BuildCommand;
  }

  if (command === "ledger") {
    const second = rest[0];
    if (second !== "record") {
      throw new Error("only `ledger record` is supported");
    }
    let actor: "human" | "agent" | undefined;
    let intent: string | undefined;
    const specRefs: string[] = [];
    const changedTargets: string[] = [];
    for (let i = 1; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--actor") {
        const value = resolveRequiredValue(rest, i, arg);
        if (value !== "human" && value !== "agent") {
          throw new Error("--actor must be human or agent");
        }
        actor = value;
        i++;
        continue;
      }
      if (arg.startsWith("--actor=")) {
        const value = arg.slice("--actor=".length);
        if (value !== "human" && value !== "agent") {
          throw new Error("--actor must be human or agent");
        }
        actor = value;
        continue;
      }
      if (arg === "--intent") {
        intent = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--intent=")) {
        intent = arg.slice("--intent=".length);
        continue;
      }
      if (arg === "--spec-ref") {
        specRefs.push(resolveRequiredValue(rest, i, arg));
        i++;
        continue;
      }
      if (arg.startsWith("--spec-ref=")) {
        specRefs.push(arg.slice("--spec-ref=".length));
        continue;
      }
      if (arg === "--changed-target") {
        changedTargets.push(resolveRequiredValue(rest, i, arg));
        i++;
        continue;
      }
      if (arg.startsWith("--changed-target=")) {
        changedTargets.push(arg.slice("--changed-target=".length));
        continue;
      }
      throw new Error(`unknown flag for ledger record: ${arg}`);
    }
    if (!actor) throw new Error("ledger record requires --actor");
    if (!intent) throw new Error("ledger record requires --intent");
    return { kind: "ledger_record", actor, intent, specRefs, changedTargets } satisfies LedgerRecordCommand;
  }

  if (command === "run") {
    const second = rest[0];
    if (second !== "qemu") {
      throw new Error("only `run qemu` is supported");
    }
    let dryRun = false;
    let timeoutMs: number | undefined;
    let readyPattern: string | undefined;
    let profileId: string | undefined;
    let caseId: string | undefined;
    let listProfiles = false;
    let listCases = false;
    for (let i = 1; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg === "--timeout") {
        timeoutMs = Number(resolveRequiredValue(rest, i, arg));
        i++;
        continue;
      }
      if (arg.startsWith("--timeout=")) {
        timeoutMs = Number(arg.slice("--timeout=".length));
        continue;
      }
      if (arg === "--ready-pattern") {
        readyPattern = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--ready-pattern=")) {
        readyPattern = arg.slice("--ready-pattern=".length);
        continue;
      }
      if (arg === "--profile") {
        profileId = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--profile=")) {
        profileId = arg.slice("--profile=".length);
        continue;
      }
      if (arg === "--case") {
        caseId = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--case=")) {
        caseId = arg.slice("--case=".length);
        continue;
      }
      if (arg === "--list-profiles") {
        listProfiles = true;
        continue;
      }
      if (arg === "--list-cases") {
        listCases = true;
        continue;
      }
      if (arg.startsWith("-")) {
        throw new Error(`unknown flag for run qemu: ${arg}`);
      }
      throw new Error(`unexpected positional argument for run qemu: ${arg}`);
    }
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new Error("--timeout requires a non-negative integer");
    }
    return {
      kind: "run_qemu",
      dryRun,
      timeoutMs,
      readyPattern,
      profileId,
      caseId,
      listProfiles,
      listCases,
    } satisfies RunQemuCommand;
  }

  if (command === "test") {
    const suites: string[] = [];
    let dryRun = false;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg.startsWith("--suite=")) {
        suites.push(arg.slice("--suite=".length));
        continue;
      }
      if (arg === "--suite") {
        const next = rest[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--suite requires a value");
        }
        suites.push(next);
        i++;
        continue;
      }
      if (arg.startsWith("-")) {
        throw new Error(`unknown flag for test: ${arg}`);
      }
      suites.push(arg);
    }
    return { kind: "test", suites, dryRun } satisfies TestCommand;
  }

  if (command === "verify") {
    const scope = rest[0] as VerifyScope;
    if (!isVerifyScope(scope)) {
      throw new Error(`unsupported verify mode: ${rest[0]}`);
    }
    let dryRun = false;
    let target: string | undefined;
    let staffPolicy: string | undefined;
    for (let i = 1; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg.startsWith("--target=")) {
        target = arg.slice("--target=".length);
        continue;
      }
      if (arg === "--target") {
        target = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg === "--staff-policy") {
        staffPolicy = resolveRequiredValue(rest, i, arg);
        i++;
        continue;
      }
      if (arg.startsWith("--staff-policy=")) {
        staffPolicy = arg.slice("--staff-policy=".length);
        continue;
      }
      if (!arg.startsWith("-")) {
        target = arg;
        continue;
      }
      throw new Error(`unknown flag for verify: ${arg}`);
    }
    return { kind: "verify", scope, target, dryRun, staffPolicy } satisfies VerifyCommand;
  }

  if (command === "trace") {
    const second = rest[0];
    if (second !== "syscall") {
      throw new Error("only `trace syscall` is supported");
    }
    let dryRun = false;
    let timeoutMs: number | undefined;
    for (const arg of rest.slice(1)) {
      if (arg === "--dry-run") {
        dryRun = true;
        continue;
      }
      if (arg.startsWith("--timeout=")) {
        timeoutMs = Number(arg.slice("--timeout=".length));
        continue;
      }
      if (arg === "--timeout") {
        throw new Error("--timeout requires a value");
      }
      if (arg.startsWith("-")) {
        throw new Error(`unknown flag for trace syscall: ${arg}`);
      }
      throw new Error(`unexpected positional argument for trace syscall: ${arg}`);
    }
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      throw new Error("--timeout requires a non-negative integer");
    }
    return { kind: "trace_syscall", dryRun, timeoutMs } satisfies TraceSyscallCommand;
  }

  if (command === "debug") {
    const second = rest[0];
    if (second !== "explain-log") {
      throw new Error("only `debug explain-log` is supported");
    }
    if (rest.length > 2) {
      throw new Error("debug explain-log accepts at most one log path");
    }
    return { kind: "debug_explain_log", logPath: rest[1] } satisfies DebugExplainLogCommand;
  }

  if (command === "report") {
    const second = rest[0];
    if (second !== "generate") {
      throw new Error("only `report generate` is supported");
    }
    let stage: string | undefined;
    let final = false;
    for (let i = 1; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--final") {
        final = true;
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
      if (arg.startsWith("-")) {
        throw new Error(`unknown flag for report generate: ${arg}`);
      }
      throw new Error(`unexpected positional argument for report generate: ${arg}`);
    }
    if (final && stage) {
      throw new Error("report generate accepts either --final or --stage, not both");
    }
    return { kind: "report_generate", stage, final } satisfies ReportGenerateCommand;
  }

  if (command === "submit") {
    const second = rest[0];
    if (second !== "pack") {
      throw new Error("only `submit pack` is supported");
    }
    return { kind: "submit_pack" } satisfies SubmitPackCommand;
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
        throw new Error(`unknown flag for kb add: ${arg}`);
      }
      return { kind: "kb_add", source, sourceKind, stage, title, recursive, manifestPath } satisfies KbAddCommand;
    }
    if (second === "list") return { kind: "kb_list" } satisfies KbListCommand;
    if (second === "search") {
      const query = rest.slice(1).join(" ").trim();
      if (!query) throw new Error("kb search requires <query>");
      return { kind: "kb_search", query } satisfies KbSearchCommand;
    }
    if (second === "remove") {
      const id = rest[1];
      if (!id || id.startsWith("-")) throw new Error("kb remove requires <source-id>");
      return { kind: "kb_remove", id } satisfies KbRemoveCommand;
    }
    if (second === "clear") return { kind: "kb_clear" } satisfies KbClearCommand;
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
      return { kind: "kb_import_manifest", manifestPath } satisfies KbImportManifestCommand;
    }
    throw new Error(`unknown kb subcommand: ${second}`);
  }

  if (command === "agent") {
    const second = rest[0];
    if (second === "serve") {
      let host: string | undefined;
      let port: number | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--host") {
          host = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--host=")) {
          host = arg.slice("--host=".length);
          continue;
        }
        if (arg === "--port") {
          port = Number(resolveRequiredValue(rest, i, arg));
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error("--port requires a valid TCP port");
          }
          i++;
          continue;
        }
        if (arg.startsWith("--port=")) {
          port = Number(arg.slice("--port=".length));
          if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error("--port requires a valid TCP port");
          }
          continue;
        }
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag for agent serve: ${arg}`);
        }
      }
      return { kind: "agent_serve", host, port } satisfies AgentServeCommand;
    }
    if (second === "context") {
      const scopeArg = parseOptionalStringValue(rest, "--scope") ?? parseOptionalStringValue(rest, "--stage");
      return { kind: "agent_context", scope: scopeArg } satisfies AgentContextCommand;
    }
    if (second === "plan") {
      let task: string | undefined;
      let scope = parseOptionalStringValue(rest, "--scope") ?? parseOptionalStringValue(rest, "--stage");
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--scope") {
          i++;
          continue;
        }
        if (arg === "--stage") {
          i++;
          continue;
        }
        if (arg.startsWith("--scope=") || arg.startsWith("--stage=")) {
          continue;
        }
        if (arg === "--task") {
          task = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--task=")) {
          task = arg.slice("--task=".length);
          continue;
        }
        if (arg.startsWith("--") && !arg.startsWith("--scope") && !arg.startsWith("--stage")) {
          throw new Error(`unknown flag for agent plan: ${arg}`);
        }
        if (task === undefined && !arg.startsWith("--")) {
          task = arg;
          for (let j = i + 1; j < rest.length; j++) {
            const next = rest[j];
            if (next.startsWith("--")) {
              break;
            }
            task = `${task} ${next}`.trim();
            i = j;
          }
        }
      }
      return { kind: "agent_plan", task, scope } satisfies AgentPlanCommand;
    }
    if (second === "generate") {
      let target: string | undefined;
      let apply = false;
      let build = false;
      let run = false;
      let task: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--target") {
          target = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--target=")) {
          target = arg.slice("--target=".length);
          continue;
        }
        if (arg === "--apply") {
          apply = true;
          continue;
        }
        if (arg === "--build") {
          build = true;
          continue;
        }
        if (arg === "--run") {
          run = true;
          continue;
        }
        if (arg === "--task") {
          task = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--task=")) {
          task = arg.slice("--task=".length);
          continue;
        }
        if (i === 1 && !arg.startsWith("--") && target === undefined) {
          target = arg;
          continue;
        }
        if (arg.startsWith("--")) {
          throw new Error(`unknown flag for agent generate: ${arg}`);
        }
      }
      if (run && !build) {
        throw new Error("`agent generate --run` requires `--build`");
      }
      if (build && !apply) {
        throw new Error("`agent generate --build` requires `--apply`");
      }
      return { kind: "agent_generate", target, apply, build, run, task } satisfies AgentGenerateCommand;
    }
    if (second === "apply-patch") {
      let patchFile: string | undefined;
      let requireSpec = true;
      let runValidation = false;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--patch-file") {
          patchFile = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--patch-file=")) {
          patchFile = arg.slice("--patch-file=".length);
          continue;
        }
        if (arg === "--no-require-spec") {
          requireSpec = false;
          continue;
        }
        if (arg === "--run-validation") {
          runValidation = true;
          continue;
        }
        if (i === 1 && !arg.startsWith("--") && patchFile === undefined) {
          patchFile = arg;
          continue;
        }
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag for agent apply-patch: ${arg}`);
        }
      }
      return {
        kind: "agent_apply_patch",
        patchFile,
        requireSpec,
        runValidation,
      } satisfies AgentApplyPatchCommand;
    }
    if (second === "validate-generated") {
      let target: string | undefined;
      let patchFile: string | undefined;
      let keepWorktree = false;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--target") {
          target = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--target=")) {
          target = arg.slice("--target=".length);
          continue;
        }
        if (arg === "--patch-file") {
          patchFile = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--patch-file=")) {
          patchFile = arg.slice("--patch-file=".length);
          continue;
        }
        if (arg === "--keep-worktree") {
          keepWorktree = true;
          continue;
        }
        if (!arg.startsWith("-") && target === undefined) {
          target = arg;
          continue;
        }
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag for agent validate-generated: ${arg}`);
        }
        throw new Error(`unexpected positional value for agent validate-generated: ${arg}`);
      }
      if (!target || target.trim().length === 0) {
        throw new Error("agent validate-generated requires --target <spec-ref|stage>");
      }
      return {
        kind: "agent_validate_generated",
        target,
        patchFile,
        keepWorktree,
      } satisfies AgentValidateGeneratedCommand;
    }
    if (second === "debug") {
      let logPath: string | undefined;
      let runId: string | undefined;
      let keepWorktree = false;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--log") {
          logPath = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--log=")) {
          logPath = arg.slice("--log=".length);
          continue;
        }
        if (arg === "--run") {
          runId = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--run=")) {
          runId = arg.slice("--run=".length);
          continue;
        }
        if (arg === "--keep-worktree") {
          keepWorktree = true;
          continue;
        }
        throw new Error(`unknown flag for agent debug: ${arg}`);
      }
      if (logPath && runId) {
        throw new Error("agent debug accepts either --log or --run, not both");
      }
      return { kind: "agent_debug", logPath, runId, keepWorktree } satisfies AgentDebugCommand;
    }
    if (second === "log") {
      let append = false;
      let inputPath: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--append") {
          append = true;
          continue;
        }
        if (arg === "--entry") {
          const next = rest[i + 1];
          if (!next || next.startsWith("-")) {
            throw new Error("--entry requires a value");
          }
          inputPath = next;
          i++;
          continue;
        }
        if (arg.startsWith("--entry=")) {
          inputPath = arg.slice("--entry=".length);
          continue;
        }
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag for agent log: ${arg}`);
        }
        if (inputPath === undefined) {
          inputPath = arg;
          continue;
        }
        throw new Error(`unexpected positional value for agent log: ${arg}`);
      }
      return { kind: "agent_log", append, inputPath } satisfies AgentLogCommand;
    }
    if (second === "review-spec") {
      let target: string | undefined;
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--target") {
          target = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--target=")) {
          target = arg.slice("--target=".length);
          continue;
        }
        if (!arg.startsWith("-") && target === undefined) {
          target = arg;
          continue;
        }
        if (arg.startsWith("-")) {
          throw new Error(`unknown flag for agent review-spec: ${arg}`);
        }
        throw new Error(`unexpected positional value for agent review-spec: ${arg}`);
      }
      return { kind: "agent_review_spec", target } satisfies AgentReviewSpecCommand;
    }
    if (second === "ask") {
      let question: string | undefined;
      const scope = parseOptionalStringValue(rest, "--scope") ?? parseOptionalStringValue(rest, "--stage");
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--scope" || arg === "--stage") {
          i++;
          continue;
        }
        if (arg.startsWith("--scope=") || arg.startsWith("--stage=")) continue;
        if (arg === "--task") {
          question = resolveRequiredValue(rest, i, arg);
          i++;
          continue;
        }
        if (arg.startsWith("--task=")) {
          question = arg.slice("--task=".length);
          continue;
        }
        if (arg.startsWith("--")) throw new Error(`unknown flag for agent ask: ${arg}`);
        question = [question, arg].filter(Boolean).join(" ");
      }
      if (!question?.trim()) throw new Error("agent ask requires a question");
      return { kind: "agent_ask", question: question.trim(), scope } satisfies AgentAskCommand;
    }

    throw new Error(`unknown agent subcommand: ${second}`);
  }

  if (command === "help") {
    return { kind: "help", topic: rest[0] };
  }

  throw new Error(`unknown command: ${command}`);
}

function isVerifyScope(value: string): value is VerifyScope {
  return [
    "public",
    "patch",
    "full",
    "invariant",
    "generated",
    "fuzz",
  ].includes(value);
}

function parseKbSourceKind(value: string): KbAddCommand["sourceKind"] {
  if (value === "course" || value === "project" || value === "external") return value;
  throw new Error("--source-kind must be one of: course, project, external");
}

function parseOptionalStringValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      return args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : undefined;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function resolveRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-") || VALUE_FLAGS.has(value)) {
    throw new Error(`error: ${flag} requires a value`);
  }
  return value;
}
