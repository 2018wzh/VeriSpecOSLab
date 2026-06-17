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
}

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
  return formatPrompt(buildPromptEnvelope({
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
}

export function buildAgentDebugPrompt(args: {
  logText: string;
  logRef: string;
}): string {
  return formatPrompt(
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
    "If you cannot produce a patch, return patch as an empty string and explain only via self_reported_risks.",
  ].join("\n");
  const contextReviewContract = [
    "PROJECT CONTEXT REVIEW:",
    "Before producing the final JSON, inspect the existing project tree and relevant specs.",
    "Use the provided project_tree as the minimum file list to reason about current files, generated outputs, and build/run contracts.",
    "If file-reading tools are available, read the relevant project files yourself before finalizing the patch.",
    "Do not assume missing files exist; generate required files explicitly in the patch.",
    "project_tree:",
    JSON.stringify(args.bundle.project_tree ?? [], null, 2),
  ].join("\n");
  const buildRunContract = args.buildRequested || args.runRequested
    ? [
      "BUILD/RUN CONTRACT:",
      "`agent generate --build` and `agent generate --run` require a patch that can validate immediately after apply.",
      "If the project does not already contain Makefile, CMakeLists.txt, xtask/Cargo.toml, or .vos/toolchain.json, include one in changed_paths and in the unified diff.",
      "Prefer a Makefile that produces build/kernel.elf, build/kernel.bin, and build/kernel.asm from the generated RISC-V kernel sources.",
      "If C code uses inline assembly, use -std=gnu11 in CFLAGS or use __asm__/__volatile__; do not combine -std=c11 with bare asm.",
      "For SBI ecall helpers in C, prefer register variables bound to a0/a1/a6/a7 and an asm template containing only `ecall`; do not use numbered operands such as %1/%2/%3 inside multi-line ecall templates unless every operand is declared correctly.",
      "The generated Makefile's default `make all` target must compile without unresolved symbols or C dialect errors.",
      "Compile kernel C code with -ffreestanding -fno-builtin -fno-stack-protector so names like exit are not treated as hosted C library builtins.",
      "For a RISC-V kernel linked at 0x80000000, compile every C and assembly object with -mcmodel=medany to avoid R_RISCV_HI20 relocation truncation.",
      "If Makefile uses -Iinclude, source files must include headers as \"defs.h\"/\"types.h\", not \"include/defs.h\".",
      "Do not define the same global symbol in assembly and C; for example kernel/kernelvec.S should export kernelvec, not kerneltrap, when kernel/trap.c defines kerneltrap().",
      "For OpenSBI/QEMU virt, link the kernel at 0x80200000 and ensure _start is the ELF entry point at the beginning of .text by using .text.entry first in the linker script.",
      "Do not reference concrete object paths inside linker scripts; use section patterns such as *(.text.entry) and *(.text .text.*).",
      "Use build/kernel.elf as the QEMU -kernel artifact; build/kernel.bin may still be generated as an auxiliary artifact.",
      "Do not leave unresolved symbols for later stages when --build or --run is requested.",
      "Generate the dependency closure needed by the requested target, including sources, assembly stubs, headers, linker script, and build entrypoint.",
      args.runRequested
        ? "For --run, the resulting kernel must be runnable by qemu-system-riscv64 and emit the success signal XV6_BOOT_OK."
        : "The resulting code must compile with the project toolchain specification.",
    ].join("\n")
    : "";

  return `${basePrompt}\n\n${strictCodegenContract}\n\n${contextReviewContract}${buildRunContract ? `\n\n${buildRunContract}` : ""}`;
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
