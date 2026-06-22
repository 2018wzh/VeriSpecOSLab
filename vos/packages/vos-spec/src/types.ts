export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SpecDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  ref?: string;
}

export interface SpecSource {
  path: string;
  kind: SpecDocumentKind;
  hash: string;
}

export type SpecDocumentKind =
  | "module"
  | "operation"
  | "concurrency"
  | "module_tests"
  | "architecture_seed"
  | "architecture_timeline"
  | "architecture_composition"
  | "architecture_slice"
  | "adr"
  | "composition"
  | "goal"
  | "spec_patch"
  | "verification_public_matrix"
  | "toolchain"
  | "unknown";

export interface NormalizedModule {
  id: string;
  module: string;
  stage: string;
  path: string;
  purpose: string;
  related_slices: string[];
  related_adrs: string[];
  test_surfaces: string[];
}

export interface NormalizedOperation {
  id: string;
  module: string;
  operation: string;
  stage: string;
  path: string;
  related_slice?: string;
  related_adr?: string;
  requires_modules: string[];
  requires_ops: string[];
  public_tests: string[];
  generated_tests: string[];
  hidden_tags: string[];
  codegen_targets: Array<{ kind?: string; path?: string; symbols?: string[]; owner?: string; mode?: string }>;
  invariants_preserved: string[];
  required_followup_checks: string[];
}

export interface ArchitectureStage {
  stage: string;
  slice?: string;
  title?: string;
  enabled_modules: string[];
  validation_gate: string[];
}

export interface NormalizedSpecBundle {
  version: "vos-spec.bundle.v1";
  spec_root: string;
  generated_at: string;
  sources: SpecSource[];
  modules: NormalizedModule[];
  operations: NormalizedOperation[];
  architecture: {
    stages: ArchitectureStage[];
    slices: Array<{ id: string; stage?: string; path: string; enabled_modules: string[]; validation_gate: string[] }>;
    decisions: Array<{ id: string; path: string }>;
  };
  composition: Array<{ id: string; title?: string; path: string; affected_modules: string[]; tests: string[] }>;
  goals: Array<{ goal_id: string; category?: string; path: string; evidence_required: string[] }>;
  toolchain_profiles: Array<{ path: string; id?: string; includes: string[] }>;
  verification: {
    public_requirements: Array<{ id: string; related_specs: string[]; required_tests: string[]; required_artifacts: string[] }>;
  };
  hashes: Record<string, string>;
  visibility: Record<string, "public" | "agent-only" | "platform-only">;
  diagnostics: SpecDiagnostic[];
}

export interface ArchitectureCompositionReport {
  target_stage: string;
  enabled_modules: string[];
  enabled_operations: string[];
  validation_gates: string[];
  composition_rules: Array<{ id: string; affected_modules: string[]; tests: string[] }>;
  conflicts: SpecDiagnostic[];
}

export interface DerivedTestMatrix {
  target_stage: string;
  public_tests: Array<{ id: string; related_specs: string[]; source: string }>;
  generated_tests: Array<{ id: string; related_specs: string[]; source: string }>;
  hidden_tags: Array<{ id: string; related_specs: string[]; source: string }>;
}

export interface SpecPatchRecord {
  id: string;
  stage: string;
  title: string;
  kind: string;
  path?: string;
  commit_sha?: string;
  parent_sha?: string;
  spec_commit_sha?: string;
  affected_specs: string[];
  affected_modules: string[];
  affected_operations: string[];
  required_regressions: string[];
}

export interface PatchImpactReport {
  patch_id: string;
  commit_sha?: string;
  parent_sha?: string;
  affected_specs: string[];
  affected_code_paths: string[];
  affected_modules: string[];
  affected_operations: string[];
  required_checks: string[];
  selected_tests: string[];
  requires_cloud_projection_refresh: boolean;
  diagnostics: SpecDiagnostic[];
}

export interface AgentSpecReview {
  status: "ok" | "unavailable" | "invalid_output";
  findings: Array<{
    severity: "info" | "warning" | "error" | "blocker";
    message: string;
    related_specs: string[];
    suggested_actions: string[];
  }>;
  summary: string;
  raw_text?: string;
}
