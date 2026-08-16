import { z } from "zod";
import { normalizeStringList } from "./utils.ts";

const stringArray = z.array(z.string()).default([]);
const optionalStringArray = z.preprocess((value) => normalizeStringList(value), stringArray);

export const agentSpecReviewSchema = z.object({
  findings: z.array(z.object({
    severity: z.enum(["info", "warning", "error", "blocker"]),
    message: z.string(),
    related_specs: optionalStringArray,
    suggested_actions: optionalStringArray,
  })).default([]),
  summary: z.string().default("agent review completed"),
}).passthrough();

// Student-facing contracts. The bundle validator rejects every retired
// source kind even when vos.yaml has not been created yet.
const v2StringArray = z.preprocess(
  (value) => normalizeStringList(value),
  z.array(z.string()).default([]),
);

const v2PropertySchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    check: z.string().min(1).optional(),
  }).strict(),
]);

const v2OperationSchema = z.object({
  name: z.string().min(1),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  pre: v2StringArray,
  post: v2StringArray,
  errors: v2StringArray,
  properties: z.array(v2PropertySchema).default([]),
}).strict();

const nonEmptyMachineProjectionSchema = z.record(z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  "machine projection must declare at least one field",
);

export const designSpecSchema = z.object({
  system: z.object({
    name: z.string().min(1),
    language: z.string().min(1),
    isa: z.string().min(1),
  }).strict(),
  machine: z.object({
    qemu: nonEmptyMachineProjectionSchema,
    hardware: nonEmptyMachineProjectionSchema,
  }).strict(),
  kernel: z.object({
    organization: z.string().min(1),
    execution: z.string().min(1),
    protection: z.string().min(1),
    communication: z.string().min(1),
    resource_model: z.string().min(1),
  }).strict(),
  required_mechanisms: z.array(z.string()),
  composition_invariants: z.array(z.string().min(1)).min(1).max(3),
  non_goals: z.array(z.string()),
  hardware_port: z.object({
    board: z.string().min(1),
    boot: z.string().min(1),
    console: z.string().min(1),
    interrupt: z.string().min(1),
  }).strict(),
}).strict();

export const moduleV2Schema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  purpose: z.string().min(1),
  owns: z.array(z.string().min(1)).min(1),
  interface: z.array(z.union([z.string().min(1), v2OperationSchema])).default([]),
  properties: z.array(v2PropertySchema).default([]),
  errors: v2StringArray,
  state: z.record(z.unknown()).optional(),
  preconditions: v2StringArray,
  postconditions: v2StringArray,
  invariants: z.array(v2PropertySchema).default([]),
  dependencies: v2StringArray,
  concurrency: z.record(z.unknown()).optional(),
  rely: v2StringArray,
  guarantee: v2StringArray,
  algorithm_intent: z.string().min(1).optional(),
}).strict();

export const interfaceSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  boundary: z.enum(["syscall", "ipc", "driver", "abi", "other"]),
  module: z.string().min(1).optional(),
  operations: z.array(v2OperationSchema).min(1),
}).strict();

export const goalV2Schema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  metric: z.string().min(1).optional(),
  oracle: z.string().min(1).optional(),
  correctness: v2StringArray,
}).strict();

export const specPatchV2Schema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  changes: z.array(z.string().min(1)).min(1),
  new_invariants: z.array(z.string().min(1)).default([]),
}).strict();

const repoRelativePathSchema = z.string().min(1).refine((value) => {
  const normalized = value.replace(/\\/g, "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)
    && normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("/../");
}, "path must be repository-relative and cannot traverse");

const qemuPortMaterialSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  path: repoRelativePathSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
  provenance: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  caveats: v2StringArray,
}).strict();

const qemuPortFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["info", "warning", "blocker"]),
  message: z.string().min(1),
  evidence: v2StringArray,
  resolution: z.object({
    status: z.literal("resolved"),
    rationale: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
  }).strict().optional(),
}).strict();

const qemuPortBaseSchema = z.object({
  version: z.literal("vos.qemu-port.v1"),
  id: z.string().min(1),
  request_id: z.string().min(1).optional(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["request", "candidate", "approved"]),
  target: z.object({ board: z.string().min(1) }).strict(),
  qemu: z.object({
    version: z.string().min(1),
    source_path: repoRelativePathSchema,
    commit: z.string().regex(/^[a-f0-9]{7,64}$/i).optional(),
  }).strict(),
  materials_dir: repoRelativePathSchema.optional(),
  materials: z.array(qemuPortMaterialSchema).optional(),
  preflight: z.object({
    run_id: z.string().min(1),
    boot_path: z.record(z.unknown()),
    reuse_matrix: z.array(z.record(z.unknown())),
    findings: z.array(qemuPortFindingSchema),
    notes: v2StringArray,
  }).strict().optional(),
  implementation: z.object({
    owns: z.array(repoRelativePathSchema).min(1),
    phases: z.array(z.record(z.unknown())).min(1),
    dependencies: z.array(z.record(z.unknown())).default([]),
  }).strict().optional(),
  acceptance: z.object({
    goal: z.literal("shell"),
    agent_defined: z.literal(true),
  }).strict().optional(),
}).strict();

export const qemuPortSpecSchema = qemuPortBaseSchema.superRefine((doc, ctx) => {
  if (doc.status === "request") {
    if (doc.revision !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revision"], message: "request revision must be 0" });
    for (const field of ["request_id", "materials_dir", "materials", "preflight", "implementation", "acceptance"] as const) {
      if (doc[field] !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is generated only after preflight` });
    }
    if (doc.qemu.commit) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qemu", "commit"], message: "qemu.commit is generated only after preflight" });
    return;
  }
  if (doc.revision < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revision"], message: `${doc.status} revision must be at least 1` });
  for (const field of ["request_id", "materials_dir", "materials", "preflight", "implementation", "acceptance"] as const) {
    if (doc[field] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required for ${doc.status} QemuSpec` });
  }
  if (!doc.qemu.commit) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qemu", "commit"], message: `qemu.commit is required for ${doc.status} QemuSpec` });
  if (doc.status === "approved") {
    for (const [index, finding] of (doc.preflight?.findings ?? []).entries()) {
      if (finding.severity === "blocker" && !finding.resolution) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["preflight", "findings", index, "resolution"], message: "approved QemuSpec cannot contain an unresolved blocker" });
      }
    }
  }
});

const v2EnvSchema = z.preprocess(
  (value) => Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.keys(value as Record<string, unknown>)
      : value,
  z.array(z.string().min(1)).default([]),
);

const commandSchema = z.object({
  program: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  env: v2EnvSchema,
  timeout: z.number().int().positive().optional(),
}).strict();

const targetSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (record.command && typeof record.command === "object" && !Array.isArray(record.command)) {
      const { command, ...rest } = record;
      return { ...(command as Record<string, unknown>), ...rest };
    }
    return record;
  },
  commandSchema.extend({
    artifacts: z.array(z.string().min(1)).default([]),
    board: z.string().min(1).optional(),
    serial: z.string().min(1).optional(),
    workload: z.string().min(1).optional(),
    success_pattern: z.string().min(1).optional(),
    failure_pattern: z.string().min(1).optional(),
  }).strict(),
);

const checkTargetSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    if (record.command && typeof record.command === "object" && !Array.isArray(record.command)) {
      const { command, ...rest } = record;
      return { ...(command as Record<string, unknown>), ...rest };
    }
    return record;
  },
  commandSchema.extend({
    kind: z.enum(["public", "contract", "fuzz", "trace"]).default("public"),
    verifies: z.array(z.string().min(1)).default([]),
    artifacts: z.array(z.string().min(1)).default([]),
    seed: z.number().int().nonnegative().optional(),
    cases: z.number().int().positive().optional(),
    reproduction_artifact: z.string().min(1).optional(),
    workload: z.string().min(1).optional(),
    oracle: z.string().min(1).optional(),
  }).strict(),
);

export const projectManifestSchema = z.object({
  version: z.literal("vos.project.v1"),
  build: targetSchema,
  runners: z.object({
    qemu: targetSchema.optional(),
    hardware: targetSchema.optional(),
  }).strict(),
  checks: z.record(checkTargetSchema).default({}),
}).strict().superRefine((manifest, ctx) => {
  const checkTargetPaths = (target: { cwd?: string; artifacts?: string[]; reproduction_artifact?: string }, path: (string | number)[]) => {
    if (target.cwd) {
      const normalized = target.cwd.replace(/\\/g, "/");
      if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "cwd"], message: "command cwd must be repository-relative and cannot traverse" });
      }
    }
    for (const [index, artifact] of (target.artifacts ?? []).entries()) {
      const normalized = artifact.replace(/\\/g, "/");
      if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "artifacts", index], message: "artifact path must be repository-relative and cannot traverse" });
      }
    }
    if (target.reproduction_artifact) {
      const normalized = target.reproduction_artifact.replace(/\\/g, "/");
      if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "reproduction_artifact"], message: "reproduction artifact path must be repository-relative and cannot traverse" });
      }
    }
  };
  checkTargetPaths(manifest.build, ["build"]);
  if (manifest.runners.qemu) checkTargetPaths(manifest.runners.qemu, ["runners", "qemu"]);
  if (manifest.runners.hardware) checkTargetPaths(manifest.runners.hardware, ["runners", "hardware"]);
  for (const [id, target] of Object.entries(manifest.checks)) {
    checkTargetPaths(target, ["checks", id]);
    if (target.kind === "fuzz") {
      if (target.seed === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "seed"], message: "fuzz targets require a fixed seed" });
      if (target.cases === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "cases"], message: "fuzz targets require a bounded case count" });
      if (!target.timeout) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "timeout"], message: "fuzz targets require a timeout" });
      if (!target.reproduction_artifact) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "reproduction_artifact"], message: "fuzz targets require a minimal reproduction artifact path" });
    }
    if (target.kind === "trace") {
      if (!target.workload) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "workload"], message: "trace targets require a workload" });
      if (!target.oracle) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "oracle"], message: "trace targets require an oracle" });
      if (!target.timeout) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "timeout"], message: "trace targets require a timeout" });
      if (target.artifacts.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id, "artifacts"], message: "trace targets require evidence artifacts" });
    }
    if (target.kind !== "fuzz" && (target.seed !== undefined || target.cases !== undefined || target.reproduction_artifact !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id], message: "seed, cases, and reproduction_artifact are only valid for fuzz targets" });
    }
    if (target.kind !== "trace" && (target.workload !== undefined || target.oracle !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checks", id], message: "workload and oracle are only valid for trace targets" });
    }
  }
  const qemu = manifest.runners.qemu;
  if (qemu && !qemu.success_pattern) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runners", "qemu", "success_pattern"],
      message: "QEMU runners require a serial success_pattern",
    });
  }
  if (qemu && !qemu.failure_pattern) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runners", "qemu", "failure_pattern"],
      message: "QEMU runners require a serial failure_pattern",
    });
  }
  for (const [path, target] of [["build", manifest.build], ["hardware", manifest.runners.hardware]] as const) {
    if (!target) continue;
    if (target.success_pattern !== undefined || target.failure_pattern !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: path === "build" ? ["build"] : ["runners", "hardware"],
        message: "success_pattern and failure_pattern are only valid for the QEMU runner",
      });
    }
  }
  if (qemu && /qemu-system/i.test(qemu.program) && !qemu.args.includes("-nographic")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runners", "qemu", "args"], message: "QEMU targets must include -nographic for serial-only evidence" });
  }
  for (const [field, pattern] of [["success_pattern", qemu?.success_pattern], ["failure_pattern", qemu?.failure_pattern]] as const) {
    if (!pattern) continue;
    try {
      new RegExp(pattern);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runners", "qemu", field],
        message: `QEMU ${field} must be a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
});
