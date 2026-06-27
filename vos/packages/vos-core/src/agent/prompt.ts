import {
  resolveAgentTaskProfile,
  type AgentTaskProfile,
} from "vos-agent/headless";

export interface PromptProfileEnvelope {
  prompt_id: string;
  system_prompt: string;
  mode: string;
  skills: string[];
  mcp_servers: string[];
  output_schema: string;
}

export interface PromptEnvelope {
  task_kind: string;
  requested_scope: string;
  spec_bindings: string[];
  context_bundle_ref: string;
  evidence_refs: string[];
  allowed_paths: string[];
  required_validations: string[];
  policy_flags: string[];
  agent_profile: PromptProfileEnvelope;
}

export interface WrappedPrompt {
  envelope: PromptEnvelope;
  task?: string;
  instructions: string;
}

interface PromptBundle {
  resolved_specs: string[];
  recent_evidence: Array<{ run_id: string }>;
  allowed_paths: string[];
  policy_flags: string[];
  project_tree?: string[];
  readonly_context?: Array<{
    path: string;
    content: string;
    truncated: boolean;
  }>;
}

export interface ToolchainGeneratePromptSpec {
  toolchainIndex: unknown;
  buildSpec: unknown;
  profileSpec?: unknown;
  runSpec?: unknown;
  allowedOutputPaths: string[];
  environment: { required_tools: Array<Record<string, unknown>> };
}

export const AGENTS_GUIDANCE_PROMPT = [
  "Read and follow applicable AGENTS.md before planning or patching.",
  "Update root AGENTS.md only when introducing or changing durable public project conventions, build/test workflow, or agent-facing rules.",
  "Do not overwrite existing AGENTS.md; patch it minimally.",
].join("\n");

export const AGENTS_READONLY_GUIDANCE_PROMPT = [
  "Read and respect applicable AGENTS.md.",
  "This command is read-only for AGENTS.md; do not modify AGENTS.md.",
  "If the result reveals a durable workflow rule that belongs there, suggest a follow-up AGENTS.md update instead.",
].join("\n");

export function buildPromptEnvelope(args: {
  taskKind: string;
  requestedScope: string;
  specBindings: string[];
  contextBundleRef: string;
  evidenceRefs: string[];
  allowedPaths: string[];
  requiredValidations: string[];
  policyFlags: string[];
  agentProfile?: AgentTaskProfile;
  task?: string;
}): WrappedPrompt {
  const agentProfile = args.agentProfile ?? resolveAgentTaskProfile({
    taskKind: args.taskKind,
  });
  const envelope: PromptEnvelope = {
    task_kind: args.taskKind,
    requested_scope: args.requestedScope,
    spec_bindings: args.specBindings,
    context_bundle_ref: args.contextBundleRef,
    evidence_refs: args.evidenceRefs,
    allowed_paths: args.allowedPaths,
    required_validations: args.requiredValidations,
    policy_flags: args.policyFlags,
    agent_profile: toPromptProfileEnvelope(agentProfile),
  };

  const instructions = [
    `You are a deterministic code assistant for a VOS runtime.`,
    `Use the schema contract exactly.`,
    `Do not execute commands.`,
    `Return JSON only.`,
    `Prompt id: ${agentProfile.promptId}`,
    `Mode: ${agentProfile.mode}`,
    `Skills: ${agentProfile.skills.length > 0 ? agentProfile.skills.join(", ") : "none"}`,
    `MCP servers: ${agentProfile.mcpServers.length > 0 ? agentProfile.mcpServers.join(", ") : "none"}`,
    `Output schema: ${agentProfile.outputSchema}`,
    `Task kind: ${args.taskKind}`,
    `Allowed paths: ${args.allowedPaths.join(", ")}`,
    AGENTS_GUIDANCE_PROMPT,
    args.task ? `Task: ${args.task}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    envelope,
    task: args.task,
    instructions,
  };
}

export function formatPrompt(wrapped: WrappedPrompt): string {
  return JSON.stringify({
    envelope: wrapped.envelope,
    task: wrapped.task,
    instructions: wrapped.instructions,
    output_contract: "STRICT_JSON",
  }, null, 2);
}

export function resolvePromptProfileEnvelope(taskKind: string): PromptProfileEnvelope {
  return toPromptProfileEnvelope(resolveAgentTaskProfile({ taskKind }));
}

export function buildAgentPlanPrompt(args: {
  bundle: PromptBundle;
  requestedScope: string;
  task?: string;
}): string {
  const basePrompt = formatPrompt(buildPromptEnvelope({
    taskKind: "plan",
    requestedScope: args.requestedScope,
    specBindings: args.bundle.resolved_specs,
    contextBundleRef: "agent-context",
    evidenceRefs: args.bundle.recent_evidence.map((entry) => entry.run_id),
    allowedPaths: args.bundle.allowed_paths,
    requiredValidations: [],
    policyFlags: args.bundle.policy_flags,
    task: args.task,
  }));
  const planContract = [
    "PLAN OUTPUT CONTRACT:",
    "Return exactly one JSON object and nothing else.",
    "Do not use markdown, tables, bullets, or prose.",
    "The JSON object must contain:",
    "  - task: string",
    "  - related_specs: string[]",
    "  - suspected_files: string[]",
    "  - required_validations: string[]",
    "  - notes: string[]",
    "  - spec_patch_required?: boolean",
    "If the plan introduces durable public project conventions, build/test workflow, or agent-facing rules, include AGENTS.md in suspected_files or notes.",
    "The task field must be a single string, not an object, array, or nested plan.",
    "Minimal valid example:",
    JSON.stringify({
      task: args.task ?? `plan ${args.requestedScope}`,
      related_specs: [],
      suspected_files: [],
      required_validations: [],
      notes: [],
    }, null, 2),
  ].join("\n");
  return `${basePrompt}\n\n${planContract}`;
}

export function buildToolchainGeneratePrompt(spec: ToolchainGeneratePromptSpec): string {
  const contract = [
    "Generate a VOS toolchain draft as JSON only.",
    "TOOLCHAIN OUTPUT CONTRACT:",
    "Return exactly one JSON object and nothing else.",
    "Do not use markdown, tables, bullets, or prose.",
    "Return { files, manifest, build_instructions, spec_refs, changed_targets }.",
    "files: Array<{ path: string; content: string }>",
    "Every file path must be relative to the project root.",
    "manifest_version: 2",
    "manifest.files must exactly reference paths present in files[].path.",
    "manifest.environment.required_tools is required.",
    "manifest.build.variants is required.",
    "manifest.run.profiles is required.",
    "manifest.run.cases is required.",
    "manifest.test.suites is required.",
    "When AGENTS.md is an allowed output path, update it only for durable build/run/test workflow or agent-facing conventions introduced by this draft.",
    "Do not exceed allowedOutputPaths just to update AGENTS.md.",
    "Example files entry: \"files\": [{ \"path\": \"Makefile\", \"content\": \"all:\\n\\ttrue\\n\" }]",
    "Compact valid example:",
    JSON.stringify({
      files: [{ path: "Makefile", content: "all:\n\ttrue\n" }],
      manifest: {
        manifest_version: 2,
        files: ["Makefile"],
        environment: { required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }] },
        build: { variants: [{ id: "baseline", commands: ["make all"], artifacts: [] }] },
        run: { profiles: [{ id: "default", command: "printf", args: ["ok"], artifacts: [] }], cases: [{ id: "smoke", profile: "default", success_regex: "ok" }] },
        test: { suites: [] },
      },
      build_instructions: "Run `vos build` after generation.",
      spec_refs: ["spec/toolchain/build.yaml"],
      changed_targets: ["Makefile", ".vos/toolchain.json"],
    }, null, 2),
    "Toolchain generation input:",
    JSON.stringify(spec, null, 2),
  ].join("\n\n");
  return contract;
}

export function buildAgentDebugPrompt(args: {
  logText: string;
  logRef: string;
}): string {
  const prompt = formatPrompt(
    buildPromptEnvelope({
      taskKind: "debug",
      requestedScope: "agent.debug",
      specBindings: [],
      contextBundleRef: "agent-context",
      evidenceRefs: [args.logRef],
      allowedPaths: ["logs", "tests", "spec", "src"],
      requiredValidations: [],
      policyFlags: ["no_exec"],
      task: args.logText,
    }),
  );
  const debugContract = [
    "DEBUG OUTPUT CONTRACT:",
    AGENTS_READONLY_GUIDANCE_PROMPT,
    "Return exactly one JSON object and nothing else.",
    "Do not use markdown, tables, bullets, or prose.",
    "The JSON object must contain these fields with exact types:",
    "  - failure_class: string — a short label for the failure category (e.g. \"boot_banner_mismatch\", \"build_error\", \"linker_error\")",
    "  - summary: string — 1-3 sentence summary of what went wrong",
    "  - suspected_clauses: string[] — spec clauses or ops that may be violated",
    "  - related_specs: string[] — paths to relevant spec files",
    "  - suspected_concepts: string[] — concepts that may be misunderstood",
    "  - evidence_chain: object[] — each with { label: string, artifact?: string, observation: string }",
    "  - visualization_steps: object[] — each with { phase: string, description: string }",
    "  - visualization_html: string — a complete self-contained HTML document with inline CSS/JS",
    "  - trace_summary?: string — optional trace evidence summary",
    "  - gdb_summary?: string — optional GDB session summary",
    "  - next_diagnostic_commands: string[] — vos commands to run next",
    "  - student_visible_limitations: string[] — caveats to show the student",
    "  - suggested_next_commands: string[] — same as next_diagnostic_commands",
    "  - suggested_next_agent_task?: string — optional next agent task",
    "All array fields (suspected_clauses, related_specs, suspected_concepts, evidence_chain, visualization_steps, next_diagnostic_commands, student_visible_limitations, suggested_next_commands) MUST be arrays, even if they contain only one item.",
    "evidence_chain entries MUST be objects, not strings. Each must have a string 'label' and string 'observation'.",
    "Minimal valid example:",
    JSON.stringify({
      failure_class: "build_error",
      summary: "The build failed due to a missing semicolon in kernel/boot.c line 12.",
      suspected_clauses: ["kernel/boot.kernel_main"],
      related_specs: ["spec/modules/kernel/boot/ops/kernel_main.yaml"],
      suspected_concepts: ["C syntax", "function definition"],
      evidence_chain: [
        { label: "build log", artifact: "build/make-all.log", observation: "error: expected ';' before '}' token" },
      ],
      visualization_steps: [
        { phase: "parse error", description: "Compiler found syntax error at kernel/boot.c:12" },
      ],
      visualization_html: "<html><body><h1>Build Error</h1><p>Missing semicolon.</p></body></html>",
      next_diagnostic_commands: ["build", "debug explain-log"],
      student_visible_limitations: ["GDB session was not available for this build-only failure"],
      suggested_next_commands: ["build", "debug explain-log"],
    }, null, 2),
    "Do not include full instrumentation patches or unified diffs in student-visible markdown or visualization_html.",
    "Log text to analyze:",
    args.logText,
  ].join("\n");
  return `${prompt}\n\n${debugContract}`;
}

export function buildAgentBehaviorTestPlanPrompt(args: {
  scope: string;
  phase: "generated" | "fuzz";
  obligations: string[];
  suites: string[];
  projectTree: string[];
}): string {
  return [
    "You are producing a VOS verify behavior TestPlan JSON.",
    "Return exactly one JSON object and nothing else.",
    "Do not execute commands.",
    "Do not generate a patch in this response.",
    "If the TestPlan implies a durable test command, directory convention, or agent-facing rule, mention that AGENTS.md should be updated by the patch step.",
    "Cover generated/fuzz obligations with user-space behavior whenever possible.",
    "Prefer automated stdin, stdout/exit/timeout oracle, and concrete user program behavior.",
    "The JSON object must contain cases[].",
    "Each case must contain id, obligation_id, purpose, carrier, stimulus.stdin, and oracle.",
    "The oracle should use success_regex, optional failure_regex, and timeout_ms.",
    `scope: ${args.scope}`,
    `phase: ${args.phase}`,
    "obligations:",
    JSON.stringify(args.obligations, null, 2),
    "mapped suites:",
    JSON.stringify(args.suites, null, 2),
    "project_tree:",
    JSON.stringify(args.projectTree, null, 2),
  ].join("\n");
}

export function buildAgentBehaviorTestPatchPrompt(args: {
  scope: string;
  phase: "generated" | "fuzz";
  testPlan: unknown;
  projectTree: string[];
}): string {
  return [
    "You are producing a VOS verify behavior patch JSON from a validated TestPlan.",
    "Return exactly one JSON object and nothing else.",
    "Only consume the validated TestPlan below; do not invent unrelated tests.",
    "Only update AGENTS.md for durable test entrypoints, command conventions, directory conventions, or agent-facing rules.",
    "Do not update AGENTS.md for temporary verification cases.",
    "The JSON object must contain patch, suites, and cases.",
    "patch must be a git-style unified diff that passes git apply --check, or an empty string when no patch is needed.",
    "Do not modify spec/, .git/, .vos/runs/, or .vos/worktrees/.",
    "Suites may be temporary worktree commands and must not require writing back to the student repo manifest.",
    "Each case must contain id, obligation_id, suite, stdin, success_regex, optional failure_regex, and timeout_ms.",
    `scope: ${args.scope}`,
    `phase: ${args.phase}`,
    "validated TestPlan:",
    JSON.stringify(args.testPlan, null, 2),
    "project_tree:",
    JSON.stringify(args.projectTree, null, 2),
  ].join("\n");
}

export function buildAgentGeneratePrompt(args: {
  bundle: PromptBundle;
  task: string;
  buildRequested: boolean;
  runRequested: boolean;
}): string {
  const basePrompt = formatPrompt(
    buildPromptEnvelope({
      taskKind: "codegen",
      requestedScope: "agent.generate",
      specBindings: args.bundle.resolved_specs,
      contextBundleRef: "agent-context",
      evidenceRefs: args.bundle.recent_evidence.map((entry) => entry.run_id),
      allowedPaths: args.bundle.allowed_paths,
      requiredValidations: [],
      policyFlags: args.bundle.policy_flags,
      task: args.task,
    }),
  );
  const strictCodegenContract = [
    "STRICT OUTPUT CONTRACT:",
    "Return exactly one JSON object and nothing else.",
    "Do not use markdown, tables, bullets, or prose.",
    "The JSON object must contain:",
    `  - task: string`,
    `  - patch: string`,
    `  - bound_clauses: string[]`,
    `  - changed_paths: string[]`,
    `  - changed_code_files: string[]`,
    `  - output_kind: "unified_diff" | "file_changes"`,
    `  - self_reported_risks: string[]`,
    "The patch field must be a single git-style unified diff string suitable for `git apply` without repair.",
    "Every file diff must include `diff --git`, `---`, `+++`, and correct hunk headers/counts.",
    "Do not return bare diffs that start only with `--- /dev/null`.",
    "Do not return an empty patch.",
    "Before final JSON, use Read or Grep to inspect every existing file you will modify; stale hunk context fails validation.",
    "If you cannot inspect an existing file, do not modify that file.",
    AGENTS_GUIDANCE_PROMPT,
    "If the patch introduces or changes durable public project conventions, build/test workflow, or agent-facing rules, it must include a minimal AGENTS.md patch.",
  ].join("\n");
  const contextReviewContract = [
    "PROJECT CONTEXT REVIEW:",
    "Before producing the final JSON, inspect the existing project tree and relevant specs with readonly tools.",
    "readonly_context contains current file contents granted through read-only access and must be treated as authoritative hunk context.",
    "For xv6-spec boot codegen, read at least .vos/toolchain.json, Makefile, kernel/main.c, kernel/defs.h, kernel/types.h, kernel/riscv.h, kernel/param.h, kernel/start.c, kernel/entry.S, kernel/kernel.ld, and the relevant spec/modules/kernel/boot and spec/modules/kernel/headers YAML files before touching those files.",
    "Use the provided project_tree as the minimum file list to reason about current files, generated outputs, and build/run contracts.",
    "If file-reading tools are available, read the relevant project files yourself before finalizing the patch.",
    "Do not assume missing files exist; generate required files explicitly in the patch.",
    "project_tree:",
    JSON.stringify(args.bundle.project_tree ?? [], null, 2),
    "readonly_context:",
    JSON.stringify(args.bundle.readonly_context ?? [], null, 2),
  ].join("\n");
  const buildRunContract = args.buildRequested || args.runRequested
    ? [
      "BUILD/RUN CONTRACT:",
      "`agent generate --build` and `agent generate --run` require a real patch that validates immediately after apply.",
    "If the project already contains .vos/toolchain.json, treat it as a read-only runtime contract: do not create, replace, rewrite, or simplify it.",
    "If the project already contains a Makefile, patch it only when the requested code change cannot build through the existing targets.",
    "If the project does not already contain Makefile, CMakeLists.txt, xtask/Cargo.toml, or .vos/toolchain.json, include one in changed_paths and in the unified diff.",
      "Prefer a Makefile that produces build/kernel.elf, build/kernel.bin, and build/kernel.asm from the generated RISC-V kernel sources.",
      "If C code uses inline assembly, use -std=gnu11 in CFLAGS or use __asm__/__volatile__; do not combine -std=c11 with bare asm.",
      "For SBI ecall helpers in C, prefer register variables bound to a0/a1/a6/a7 and an asm template containing only `ecall`; do not use numbered operands such as %1/%2/%3 inside multi-line ecall templates unless every operand is declared correctly.",
      "The generated Makefile's default `make all` target must compile without unresolved symbols or C dialect errors.",
      "Compile kernel C code with -ffreestanding -fno-builtin -fno-stack-protector so names like exit are not treated as hosted C library builtins.",
      "For a RISC-V kernel linked at 0x80000000, compile every C and assembly object with -mcmodel=medany to avoid R_RISCV_HI20 relocation truncation.",
    "Follow the existing header layout from project_tree; do not introduce an include/ directory when the project already uses kernel/*.h headers.",
    "If Makefile uses -Iinclude, source files must include headers as \"defs.h\"/\"types.h\", not \"include/defs.h\".",
      "Do not define the same global symbol in assembly and C; for example kernel/kernelvec.S should export kernelvec, not kerneltrap, when kernel/trap.c defines kerneltrap().",
      "For OpenSBI/QEMU virt, link the kernel at 0x80200000 and ensure _start is the ELF entry point at the beginning of .text by using .text.entry first in the linker script.",
      "Do not reference concrete object paths inside linker scripts; use section patterns such as *(.text.entry) and *(.text .text.*).",
      "Use build/kernel.elf as the QEMU -kernel artifact; build/kernel.bin may still be generated as an auxiliary artifact.",
      "Do not leave unresolved symbols for later stages when --build or --run is requested.",
    "For xv6-spec, preserve the existing runtime boot path when kernel/main.c already reaches userinit and scheduler: keep start.c jumping to main(), keep kernel/main.o in Makefile, and do not replace that path with kernel_main().",
    "For xv6-spec qemu uses -bios none; do not put SBI ecall console_putchar/shutdown calls on the boot path. Reuse the existing UART/printk path for boot output.",
    "Adding spec-required boot helpers in kernel/boot.c is acceptable, but they must not break shell_boots, shell_executes_echo, or usertests_all_pass.",
      "Generate the dependency closure needed by the requested target, including sources, assembly stubs, headers, linker script, and build entrypoint.",
      args.runRequested
        ? "For --run, the resulting kernel must be runnable by qemu-system-riscv64 and emit the success signal XV6_BOOT_OK."
        : "The resulting code must compile with the project toolchain specification.",
    ].join("\n")
    : "";
  const verifyContract = args.buildRequested || args.runRequested
    ? [
      "VERIFY CONTRACT:",
      "A buildable or runnable patch must also be verifiable by vos-cli.",
      "If .vos/toolchain.json already exists, do not create or replace it; the CLI will run the existing build/run/verify contracts after apply.",
      "If you create .vos/toolchain.json for a project that lacks one, use manifest_version 2 with build.variants, run.profiles, run.cases, and object-form test.suites.",
      "Include verify.full, verify.invariant, verify.fuzz, and verify.generated mappings in .vos/toolchain.json when the relevant spec obligations exist.",
      "Every verify mapping value must name an existing test.suites entry; do not invent suite names without adding an object-form suite with kind.",
      "Public matrix required_tests must be covered by same-name test.suites; generated, invariant, and fuzz obligations use explicit verify mappings.",
      "Generated tests, invariant obligations, and fuzz/hidden tags from operation specs must have suite coverage or be listed in self_reported_risks.",
      "For xv6-spec, cover boot banner, allocator, trap/syscall, usertests, and grind-style fuzz/regression entrypoints when those stages are in scope.",
      "Do not include hidden/staff-only test source in the patch; staff-only checks should use a staff-visible external mapping, not repo-visible hidden content.",
      args.runRequested
        ? "For --run, QEMU must emit XV6_BOOT_OK and the verify suites must still be runnable after the boot path succeeds."
        : "For --build, the generated test suites must be runnable after the build completes.",
    ].join("\n")
    : "";

  return `${basePrompt}\n\n${strictCodegenContract}\n\n${contextReviewContract}${buildRunContract ? `\n\n${buildRunContract}` : ""}${verifyContract ? `\n\n${verifyContract}` : ""}`;
}

function toPromptProfileEnvelope(profile: AgentTaskProfile): PromptProfileEnvelope {
  return {
    prompt_id: profile.promptId,
    system_prompt: profile.systemPrompt,
    mode: profile.mode,
    skills: [...profile.skills],
    mcp_servers: [...profile.mcpServers],
    output_schema: profile.outputSchema,
  };
}
