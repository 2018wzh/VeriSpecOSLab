import { z } from "zod";
import { normalizeStringList } from "./utils.ts";

const stringArray = z.array(z.string()).default([]);
const optionalStringArray = z.preprocess((value) => normalizeStringList(value), stringArray);

export const moduleSchema = z.object({
  id: z.string().min(1),
  module: z.string().min(1),
  stage: z.string().min(1),
  purpose: z.string().min(1),
  related_slices: optionalStringArray,
  related_adrs: optionalStringArray,
  owned_state: optionalStringArray,
  exported_interfaces: optionalStringArray,
  imported_interfaces: optionalStringArray,
  module_invariants: optionalStringArray,
  error_model: optionalStringArray,
  resource_lifetime_rules: optionalStringArray,
  security_boundary: optionalStringArray,
  test_surfaces: optionalStringArray,
}).passthrough();

export const operationSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  module: z.string().min(1),
  operation: z.string().min(1),
  purpose: z.string().min(1),
  depends_on: z.object({
    requires_modules: optionalStringArray,
    requires_ops: optionalStringArray,
  }).passthrough(),
  rely: z.record(z.unknown()).optional(),
  guarantee: z.record(z.unknown()),
  preconditions: optionalStringArray,
  postconditions: optionalStringArray,
  invariants_preserved: optionalStringArray,
  failure_semantics: optionalStringArray.or(z.string().transform((value) => [value])),
  concurrency: z.record(z.unknown()).optional(),
  security: z.record(z.unknown()).optional(),
  observability: z.record(z.unknown()).optional(),
  test_obligations: z.object({
    public: optionalStringArray,
    generated: optionalStringArray,
    hidden_tags: optionalStringArray,
  }).passthrough(),
  codegen: z.object({
    targets: z.array(z.object({
      kind: z.string().optional(),
      path: z.string().optional(),
      symbols: optionalStringArray,
      owner: z.string().optional(),
      mode: z.string().optional(),
    }).passthrough()).default([]),
    forbidden_changes: optionalStringArray,
    required_followup_checks: optionalStringArray,
  }).passthrough(),
  related_slice: z.string().nullable().optional(),
  related_adr: z.string().nullable().optional(),
}).passthrough();

export const timelineSchema = z.object({
  timeline: z.array(z.object({
    stage: z.string().optional(),
    slice: z.string().optional(),
    title: z.string().optional(),
    enabled_modules: optionalStringArray,
    validation_gate: optionalStringArray,
  }).passthrough()),
}).passthrough();

export const architectureSliceSchema = z.object({
  id: z.string().min(1),
  stage: z.string().optional(),
  enabled_modules: optionalStringArray,
  validation_gate: optionalStringArray,
}).passthrough();

export const compositionSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  affected_modules: optionalStringArray,
  cross_component_rules: z.array(z.object({
    name: z.string().optional(),
    tests: optionalStringArray,
  }).passthrough()).default([]),
}).passthrough();

export const goalSchema = z.object({
  goal_id: z.string().min(1),
  category: z.string().optional(),
  evidence_required: optionalStringArray,
}).passthrough();

export const publicMatrixSchema = z.object({
  public_requirements: z.array(z.object({
    id: z.string().min(1),
    related_specs: optionalStringArray,
    required_tests: optionalStringArray,
    required_artifacts: optionalStringArray,
  }).passthrough()).default([]),
}).passthrough();

export const specPatchSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
  kind: z.enum(["architecture_change", "module_change", "operation_change", "toolchain_change"]),
  commit_sha: z.string().nullable().optional(),
  parent_sha: z.string().nullable().optional(),
  spec_commit_sha: z.string().nullable().optional(),
  affected_specs: optionalStringArray,
  affected_modules: optionalStringArray,
  affected_operations: optionalStringArray,
  before: z.unknown(),
  after: z.unknown(),
  risks: optionalStringArray,
  required_regressions: optionalStringArray,
  approval_notes: z.string().optional(),
}).passthrough();

export const agentSpecReviewSchema = z.object({
  findings: z.array(z.object({
    severity: z.enum(["info", "warning", "error", "blocker"]),
    message: z.string(),
    related_specs: optionalStringArray,
    suggested_actions: optionalStringArray,
  })).default([]),
  summary: z.string().default("agent review completed"),
}).passthrough();
