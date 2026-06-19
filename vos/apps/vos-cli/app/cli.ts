import type {
  AgentApplyPatchCommand,
  AgentContextCommand,
  AgentDebugCommand,
  AgentGenerateCommand,
  AgentLogCommand,
  AgentPlanCommand,
  AgentServeCommand,
  AgentValidateGeneratedCommand,
  ArchComposeCommand,
  ArchDeriveTestsCommand,
  ArchLintCommand,
  BuildCommand,
  CliCommand,
  DebugExplainLogCommand,
  DoctorCommand,
  GlobalOptions,
  InitCommand,
  ParsedInvocation,
  ReportGenerateCommand,
  RunQemuCommand,
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
} from "./types.ts";

const VALUE_FLAGS = new Set([
  "--project-root",
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
  "--apply",
  "--build",
  "--run",
  "--no-require-spec",
  "--run-validation",
  "--patch-file",
  "--keep-worktree",
]);

export function parseArgs(argv: string[]): ParsedInvocation {
  const input = argv.slice(2);

  const global: GlobalOptions = {
    projectRoot: process.cwd(),
    json: false,
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

function parseCommand(tokens: string[], global: GlobalOptions): CliCommand {
  const [command, ...rest] = tokens;
  void global;

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
        return { kind: "spec_patch_lint", patchPath: rest[2] } satisfies SpecPatchLintCommand;
      }
      if (sub === "apply") {
        const patchPath = rest[2];
        const hasStdin = rest.includes("-");
        return { kind: "spec_patch_apply", patchPath: hasStdin ? undefined : patchPath, inputFromStdin: hasStdin } satisfies SpecPatchApplyCommand;
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
    let dryRun = false;
    let toolchainPath: string | undefined;
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
      throw new Error(`unknown flag for build: ${arg}`);
    }
    return { kind: "build", dryRun, toolchainPath } satisfies BuildCommand;
  }

  if (command === "run") {
    const second = rest[0];
    if (second !== "qemu") {
      throw new Error("only `run qemu` is supported");
    }
    let dryRun = false;
    let timeoutMs: number | undefined;
    let readyPattern: string | undefined;
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
      if (!arg.startsWith("-")) {
        target = arg;
        continue;
      }
      throw new Error(`unknown flag for verify: ${arg}`);
    }
    return { kind: "verify", scope, target, dryRun } satisfies VerifyCommand;
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
    return { kind: "report_generate" } satisfies ReportGenerateCommand;
  }

  if (command === "submit") {
    const second = rest[0];
    if (second !== "pack") {
      throw new Error("only `submit pack` is supported");
    }
    return { kind: "submit_pack" } satisfies SubmitPackCommand;
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
      return { kind: "agent_debug", logPath: parseOptionalStringValue(rest, "--log") } satisfies AgentDebugCommand;
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
    "fuzz",
    "base",
    "architecture",
    "composition",
    "goal",
  ].includes(value);
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
