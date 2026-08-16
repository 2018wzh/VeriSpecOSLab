import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Graph, alg } from "graphlib";
import simpleGit from "simple-git";
import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  agentSpecReviewSchema,
  designSpecSchema,
  goalV2Schema,
  interfaceSpecSchema,
  moduleV2Schema,
  projectManifestSchema,
  qemuPortSpecSchema,
  specPatchV2Schema,
} from "./schemas.ts";
import type {
  AgentSpecReview,
  ArchitectureCompositionReport,
  ArchitectureStage,
  DerivedTestMatrix,
  NormalizedModule,
  NormalizedModuleV2,
  NormalizedInterface,
  NormalizedOperation,
  NormalizedSpecBundle,
  NormalizedQemuPortSpec,
  PatchImpactReport,
  SpecDiagnostic,
  SpecDocumentKind,
  SpecPatchRecord,
  SpecSource,
} from "./types.ts";
import {
  byId,
  byPath,
  errorDiagnostic,
  errorMessage,
  expandModuleRefs,
  inferVisibility,
  isRecord,
  isSpecYamlPath,
  isString,
  moduleMatches,
  normalizePath,
  sha256,
  unique,
} from "./utils.ts";

export type {
  AgentSpecReview,
  ArchitectureCompositionReport,
  ArchitectureStage,
  DerivedTestMatrix,
  DiagnosticSeverity,
  NormalizedModule,
  NormalizedModuleV2,
  NormalizedInterface,
  NormalizedOperation,
  NormalizedSpecBundle,
  NormalizedQemuPortSpec,
  PatchImpactReport,
  SpecDiagnostic,
  SpecDocumentKind,
  SpecPatchRecord,
  SpecSource,
} from "./types.ts";

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type QemuPortSpec = z.infer<typeof qemuPortSpecSchema>;

export { moduleMatches } from "./utils.ts";

export function parseProjectManifest(value: unknown): ProjectManifest {
  return projectManifestSchema.parse(value);
}

export function parseQemuPortSpec(value: unknown): QemuPortSpec {
  return qemuPortSpecSchema.parse(value);
}

export function parseAgentSpecReview(value: unknown, rawText?: string): AgentSpecReview {
  const parsed = agentSpecReviewSchema.parse(value);
  return {
    status: "ok",
    findings: parsed.findings,
    summary: parsed.summary,
    raw_text: rawText,
  };
}

export async function buildNormalizedSpecBundle(params: {
  projectRoot: string;
  specRoot?: string;
  targetPath?: string;
}): Promise<NormalizedSpecBundle> {
  const projectRoot = path.resolve(params.projectRoot);
  const specRoot = path.resolve(projectRoot, params.specRoot ?? "spec");
  const targetRoot = params.targetPath ? path.resolve(projectRoot, params.targetPath) : specRoot;
  const files = await discoverSpecFiles(targetRoot);
  const diagnostics: SpecDiagnostic[] = [];
  const sources: SpecSource[] = [];
  const hashes: Record<string, string> = {};
  const modules: NormalizedModule[] = [];
  const normalizedModules: NormalizedModuleV2[] = [];
  const interfaces: NormalizedInterface[] = [];
  const operations: NormalizedOperation[] = [];
  const stages: ArchitectureStage[] = [];
  const slices: NormalizedSpecBundle["architecture"]["slices"] = [];
  const decisions: NormalizedSpecBundle["architecture"]["decisions"] = [];
  const compositions: NormalizedSpecBundle["composition"] = [];
  const goals: NormalizedSpecBundle["goals"] = [];
  const qemuPorts: NormalizedQemuPortSpec[] = [];
  const toolchainProfiles: NormalizedSpecBundle["toolchain_profiles"] = [];
  const publicRequirements: NormalizedSpecBundle["verification"]["public_requirements"] = [];
  const patchRecords: SpecPatchRecord[] = [];
  const v2ModulePaths = new Set<string>();
  const v2GoalPaths = new Set<string>();
  const v2PatchPaths = new Set<string>();
  let design: NormalizedSpecBundle["design"] = null;
  let seedDoc: Record<string, unknown> | null = null;

  for (const file of files) {
    const rel = normalizePath(path.relative(projectRoot, file));
    const raw = await readFile(file, "utf8");
    const hash = sha256(raw);
    hashes[rel] = hash;
    const kind = classifySpecFile(rel);
    sources.push({ path: rel, kind, hash });

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (error) {
      diagnostics.push(errorDiagnostic("yaml_parse", `YAML parse failed: ${errorMessage(error)}`, rel));
      continue;
    }
    if (!isRecord(parsed)) {
      diagnostics.push(errorDiagnostic("schema.invalid_top_level", "spec file must contain a YAML object", rel));
      continue;
    }

    try {
      if (kind === "design") {
        const doc = designSpecSchema.parse(parsed);
        design = { id: "design", path: rel, document: doc };
      } else if (kind === "module" && typeof parsed.level === "number") {
        const doc = moduleV2Schema.parse(parsed);
        const missingFields = missingModuleLevelFields(parsed);
        if (missingFields.length > 0) {
          diagnostics.push(errorDiagnostic(
            "module.level_fields_missing",
            `ModuleSpec L${parsed.level} is missing required field(s): ${missingFields.join(", ")}`,
            rel,
            typeof parsed.id === "string" ? parsed.id : undefined,
          ));
          continue;
        }
        const normalized = normalizeModuleV2(doc, rel);
        v2ModulePaths.add(rel);
        normalizedModules.push(normalized);
        modules.push({
          id: doc.id,
          module: doc.module,
          stage: "design",
          path: rel,
          purpose: doc.purpose,
          related_slices: [],
          related_adrs: [],
          test_surfaces: doc.owns,
        });
        operations.push(...normalized.operations);
      } else if (kind === "interface") {
        const doc = interfaceSpecSchema.parse(parsed);
        const operationsForInterface = doc.operations.map((operation) => normalizeOperation(operation, doc.name, rel));
        interfaces.push({
          id: doc.id,
          name: doc.name,
          path: rel,
          boundary: doc.boundary,
          module: doc.module,
          operations: operationsForInterface,
        });
        operations.push(...operationsForInterface);
      } else if (kind === "goal" && isRecord(parsed) && typeof parsed.objective === "string") {
        const doc = goalV2Schema.parse(parsed);
        v2GoalPaths.add(rel);
        goals.push({
          goal_id: doc.id,
          category: "goal",
          path: rel,
          evidence_required: [...doc.correctness, ...(doc.metric ? [doc.metric] : [])],
        });
      } else if (kind === "spec_patch" && isRecord(parsed) && Array.isArray(parsed.changes)) {
        const doc = specPatchV2Schema.parse(parsed);
        v2PatchPaths.add(rel);
        patchRecords.push({
          id: doc.id,
          stage: "design",
          title: doc.reason,
          kind: "module_change",
          path: rel,
          affected_specs: doc.changes,
          affected_modules: doc.changes,
          affected_operations: [],
          required_regressions: [],
        });
      } else if (kind === "qemu_port") {
        const doc = qemuPortSpecSchema.parse(parsed);
        qemuPorts.push({
          id: doc.id,
          request_id: doc.request_id ?? doc.id,
          revision: doc.revision,
          status: doc.status,
          path: rel,
          target: doc.target,
          qemu: doc.qemu,
          materials_dir: doc.materials_dir ?? `references/qemu/${doc.id}`,
          materials: doc.materials ?? [],
          findings: doc.preflight?.findings ?? [],
          owns: doc.implementation?.owns ?? [],
          document: doc as Record<string, unknown>,
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        for (const issue of error.issues) {
          diagnostics.push(errorDiagnostic(
            "schema.validation_failed",
            `${issue.path.join(".") || "root"}: ${issue.message}`,
            rel,
          ));
        }
      } else {
        diagnostics.push(errorDiagnostic("schema.validation_failed", errorMessage(error), rel));
      }
    }
  }

  const manifest = await loadProjectManifest(projectRoot, diagnostics);
  diagnostics.push(...validateStudentSourceKinds(sources, v2ModulePaths, v2GoalPaths, v2PatchPaths));
  diagnostics.push(...runSemanticChecks({
    projectRoot,
    specRoot,
    modules,
    normalizedModules,
    interfaces,
    design,
    operations,
    stages,
    slices,
    compositions,
    publicRequirements,
    goals,
    patchRecords,
    manifest,
  }));
  return {
    version: "vos-spec.bundle.v2",
    spec_root: normalizePath(path.relative(projectRoot, specRoot)) || "spec",
    generated_at: new Date().toISOString(),
    sources: sources.sort(byPath),
    design,
    interfaces: interfaces.sort(byId),
    normalized_modules: normalizedModules.sort(byId),
    modules: modules.sort(byId),
    operations: operations.sort(byId),
    architecture: {
      seed: seedDoc,
      stages: stages.sort((a, b) => a.stage.localeCompare(b.stage)),
      slices: slices.sort(byId),
      decisions: decisions.sort(byId),
    },
    composition: compositions.sort(byId),
    patch_records: patchRecords.sort(byId),
    goals: goals.sort((a, b) => a.goal_id.localeCompare(b.goal_id)),
    qemu_ports: qemuPorts.sort(byId),
    toolchain_profiles: toolchainProfiles.sort(byPath),
    verification: {
      public_requirements: publicRequirements.sort(byId),
    },
    hashes,
    visibility: Object.fromEntries(sources.map((source) => [source.path, inferVisibility(source.path)])),
    manifest,
    diagnostics,
  };
}

function validateStudentSourceKinds(
  sources: SpecSource[],
  v2ModulePaths: Set<string>,
  v2GoalPaths: Set<string>,
  v2PatchPaths: Set<string>,
): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  for (const source of sources) {
    if (source.kind === "module" && !v2ModulePaths.has(source.path)) {
      diagnostics.push(errorDiagnostic("spec.legacy_kind_rejected", "student projects require the strict v2 ModuleSpec schema with a level field", source.path));
      continue;
    }
    if (source.kind === "goal" && !v2GoalPaths.has(source.path)) {
      diagnostics.push(errorDiagnostic("spec.legacy_kind_rejected", "student projects require the strict v2 GoalSpec schema", source.path));
      continue;
    }
    if (source.kind === "spec_patch" && !v2PatchPaths.has(source.path)) {
      diagnostics.push(errorDiagnostic("spec.legacy_kind_rejected", "student projects require patches under spec/patches using the strict v2 SpecPatch schema", source.path));
      continue;
    }
    if (!["design", "module", "interface", "goal", "spec_patch", "qemu_port"].includes(source.kind)) {
      diagnostics.push(errorDiagnostic("spec.legacy_kind_rejected", `student projects do not accept legacy Spec kind ${source.kind}`, source.path));
    }
  }
  return diagnostics;
}

export function hasBlockingDiagnostics(diagnostics: readonly SpecDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export async function discoverSpecFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files = await glob(["**/*.yaml", "**/*.yml"], {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: true,
  });
  return files.sort();
}

function normalizeModuleV2(
  doc: z.infer<typeof moduleV2Schema>,
  rel: string,
): NormalizedModuleV2 {
  const operations = doc.interface.map((operation) => normalizeOperation(operation, doc.module, rel));
  return {
    id: doc.id,
    module: doc.module,
    path: rel,
    level: doc.level,
    purpose: doc.purpose,
    owns: doc.owns,
    state: doc.state ?? null,
    dependencies: doc.dependencies,
    properties: doc.properties.map(normalizeProperty),
    preconditions: doc.preconditions,
    postconditions: doc.postconditions,
    invariants: doc.invariants.map(normalizeProperty),
    errors: doc.errors,
    concurrency: doc.concurrency ?? null,
    rely: doc.rely,
    guarantee: doc.guarantee,
    algorithm_intent: doc.algorithm_intent,
    operations,
  };
}

function missingModuleLevelFields(doc: Record<string, unknown>): string[] {
  const required = ["interface", "properties", "errors", "owns"];
  if (doc.level === 2 || doc.level === 3) {
    required.push("state", "preconditions", "postconditions", "invariants", "dependencies");
  }
  if (doc.level === 3) {
    required.push("concurrency", "rely", "guarantee", "algorithm_intent");
  }
  return required.filter((field) => !Object.hasOwn(doc, field));
}

function normalizeOperation(operation: unknown, owner: string, rel: string): NormalizedOperation {
  const record = typeof operation === "string" ? { name: operation } : (operation as Record<string, unknown>);
  const name = typeof record.name === "string" ? record.name : "operation";
  const properties = Array.isArray(record.properties) ? record.properties.map(normalizeProperty) : [];
  const preconditions = stringList(record.pre);
  const postconditions = stringList(record.post);
  const errors = stringList(record.errors);
  const checks = properties.map((property) => property.check).filter((value): value is string => Boolean(value));
  return {
    id: `${owner}.${name}`,
    module: owner,
    operation: name,
    stage: "design",
    path: rel,
    requires_modules: [],
    requires_ops: [],
    public_tests: checks,
    generated_tests: [],
    hidden_tags: [],
    codegen_targets: [],
    invariants_preserved: properties.map((property) => property.text),
    required_followup_checks: [...preconditions, ...postconditions, ...errors],
  };
}

function normalizeProperty(value: unknown): { id: string; text: string; check?: string } {
  if (typeof value === "string") {
    const id = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "property";
    return { id, text: value };
  }
  const record = value as Record<string, unknown>;
  return {
    id: String(record.id ?? "property"),
    text: String(record.text ?? ""),
    check: typeof record.check === "string" ? record.check : undefined,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function loadProjectManifest(
  projectRoot: string,
  diagnostics: SpecDiagnostic[],
): Promise<NormalizedSpecBundle["manifest"]> {
  const manifestPath = path.join(projectRoot, "vos.yaml");
  if (!existsSync(manifestPath)) return undefined;
  const rel = normalizePath(path.relative(projectRoot, manifestPath));
  const raw = await readFile(manifestPath, "utf8");
  try {
    const parsed = projectManifestSchema.parse(parseYaml(raw));
    const checks = Object.entries(parsed.checks).map(([id, target]) => ({
      id,
      command: [target.program, ...target.args].join(" "),
      verifies: target.verifies,
    })).sort(byId);
    return {
      path: rel,
      hash: sha256(raw),
      targets: ["build", ...Object.keys(parsed.runners).map((name) => `run:${name}`)],
      artifacts: [
        ...parsed.build.artifacts,
        ...Object.values(parsed.runners).flatMap((target) => target?.artifacts ?? []),
      ].sort(),
      checks,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      for (const issue of error.issues) {
        diagnostics.push(errorDiagnostic(
          "manifest.validation_failed",
          `${issue.path.join(".") || "root"}: ${issue.message}`,
          rel,
        ));
      }
    } else {
      diagnostics.push(errorDiagnostic("manifest.parse_failed", errorMessage(error), rel));
    }
    return undefined;
  }
}

export function composeArchitecture(bundle: NormalizedSpecBundle, targetStage?: string): ArchitectureCompositionReport {
  const stage = targetStage ?? bundle.architecture.stages.at(-1)?.stage ?? "";
  const stageIndex = bundle.architecture.stages.findIndex((item) => item.stage === stage);
  const activeStages = stageIndex >= 0 ? bundle.architecture.stages.slice(0, stageIndex + 1) : bundle.architecture.stages;
  const modulesFromStages = activeStages.flatMap((item) => item.enabled_modules);
  const modulesFromSlices = bundle.architecture.slices
    .filter((slice) => !slice.stage || activeStages.some((item) => item.stage === slice.stage || item.slice === slice.id))
    .flatMap((slice) => slice.enabled_modules);
  const enabledModules = modulesFromStages.length === 0 && modulesFromSlices.length === 0
    ? bundle.modules.map((module) => module.module)
    : expandModuleRefs(unique([...modulesFromStages, ...modulesFromSlices]), bundle.modules);
  const enabledOperations = bundle.operations
    .filter((operation) => enabledModules.some((module) => moduleMatches(operation.module, module)))
    .map((operation) => operation.id);
  const validationGates = unique([
    ...activeStages.flatMap((item) => item.validation_gate),
    ...bundle.architecture.slices.flatMap((slice) => slice.validation_gate),
  ]);
  const conflicts = validateCompositionRefs(bundle.composition, bundle.modules);
  return {
    target_stage: stage,
    enabled_modules: enabledModules,
    enabled_operations: enabledOperations,
    validation_gates: validationGates,
    composition_rules: bundle.composition
      .filter((rule) => rule.affected_modules.some((module) => enabledModules.some((enabled) => moduleMatches(enabled, module))))
      .map((rule) => ({ id: rule.id, affected_modules: rule.affected_modules, tests: rule.tests })),
    conflicts,
  };
}

export function deriveTestMatrix(bundle: NormalizedSpecBundle, targetStage?: string): DerivedTestMatrix {
  const composition = composeArchitecture(bundle, targetStage);
  const enabled = new Set(composition.enabled_operations);
  const ops = bundle.operations.filter((operation) => enabled.has(operation.id));
  const publicTests = new Map<string, { id: string; related_specs: string[]; source: string }>();
  const generatedTests = new Map<string, { id: string; related_specs: string[]; source: string }>();
  const hiddenTags = new Map<string, { id: string; related_specs: string[]; source: string }>();

  for (const op of ops) {
    for (const test of op.public_tests) {
      publicTests.set(test, { id: test, related_specs: [op.path, op.id], source: op.path });
    }
    for (const test of op.generated_tests) {
      generatedTests.set(test, { id: test, related_specs: [op.path, op.id], source: op.path });
    }
    for (const tag of op.hidden_tags) {
      hiddenTags.set(tag, { id: tag, related_specs: [op.path, op.id], source: op.path });
    }
  }
  for (const req of bundle.verification.public_requirements) {
    publicTests.set(req.id, { id: req.id, related_specs: req.related_specs, source: "spec/verification/public-matrix.yaml" });
    for (const test of req.required_tests) {
      publicTests.set(test, { id: test, related_specs: req.related_specs, source: "spec/verification/public-matrix.yaml" });
    }
  }
  for (const rule of composition.composition_rules) {
    for (const test of rule.tests) {
      generatedTests.set(test, { id: test, related_specs: [rule.id], source: rule.id });
    }
  }
  for (const check of bundle.manifest?.checks ?? []) {
    publicTests.set(check.id, { id: check.id, related_specs: check.verifies, source: bundle.manifest?.path ?? "vos.yaml" });
  }
  return {
    target_stage: composition.target_stage,
    public_tests: [...publicTests.values()].sort(byId),
    generated_tests: [...generatedTests.values()].sort(byId),
    hidden_tags: [...hiddenTags.values()].sort(byId),
  };
}

export async function resolveSpecPatch(params: {
  projectRoot: string;
  specRoot?: string;
  ref: string;
  bundle?: NormalizedSpecBundle;
  strict?: boolean;
}): Promise<{ patch: SpecPatchRecord; impact: PatchImpactReport }> {
  if (!params.ref || params.ref === "-") {
    throw new Error("spec patch commands require a SpecPatch YAML path or commit-ish; use `vos agent apply-patch` for unified diffs");
  }
  const projectRoot = path.resolve(params.projectRoot);
  const bundle = params.bundle ?? await buildNormalizedSpecBundle({ projectRoot, specRoot: params.specRoot });
  const resolved = await loadSpecPatchRecord(projectRoot, params.ref, bundle);
  const patch = resolved.patch;
  const changedFiles = await changedFilesForPatch(projectRoot, patch, params.ref, params.strict === true);
  const derivedImpact = derivePatchImpact(bundle, patch, changedFiles, params.strict === true);
  const diagnostics = [
    ...validatePatchRecord(bundle, patch, changedFiles),
    ...derivedImpact.diagnostics,
    ...validateStrictPatchRecord(projectRoot, patch, resolved.trailers, resolved.metadataCommitSha, params.strict === true),
  ];
  const relatedOps = bundle.operations.filter((operation) =>
    derivedImpact.affected_operations.includes(operation.id) ||
    derivedImpact.affected_modules.some((module) => moduleMatches(operation.module, module)) ||
    patch.affected_specs.includes(operation.path)
  );
  const selectedTests = unique([
    ...relatedOps.flatMap((operation) => operation.public_tests),
    ...patch.required_regressions,
  ]);
  const requiredChecks = unique([
    "spec lint",
    "arch lint",
    ...selectedTests.map((test) => `test ${test}`),
    ...relatedOps.flatMap((operation) => operation.required_followup_checks),
  ]);
  return {
    patch,
    impact: {
      patch_id: patch.id,
      commit_sha: patch.commit_sha,
      parent_sha: patch.parent_sha,
      affected_specs: patch.affected_specs,
      affected_code_paths: changedFiles.filter((file) => !file.startsWith("spec/")),
      affected_modules: derivedImpact.affected_modules,
      affected_operations: derivedImpact.affected_operations,
      required_checks: requiredChecks,
      selected_tests: selectedTests,
      requires_cloud_projection_refresh: patch.kind === "architecture_change" || patch.kind === "toolchain_change",
      diagnostics,
    },
  };
}

export function selectPatchVerificationChecks(impact: PatchImpactReport): string[] {
  return impact.required_checks.length > 0 ? impact.required_checks : ["spec lint", "arch lint", "build"];
}

async function loadSpecPatchRecord(
  projectRoot: string,
  ref: string,
  bundle: NormalizedSpecBundle,
): Promise<{ patch: SpecPatchRecord; trailers?: Record<string, string>; metadataCommitSha?: string }> {
  const absolute = path.resolve(projectRoot, ref);
  if (existsSync(absolute)) {
    const rel = normalizePath(path.relative(projectRoot, absolute));
    const raw = await readFile(absolute, "utf8");
    const parsed = specPatchV2Schema.parse(parseYaml(raw));
    const patchRecord = {
      id: parsed.id,
      stage: "design",
      title: parsed.reason,
      kind: "module_change",
      path: rel,
      commit_sha: undefined,
      parent_sha: undefined,
      spec_commit_sha: undefined,
      affected_specs: parsed.changes,
      affected_modules: parsed.changes,
      affected_operations: [],
      required_regressions: [],
    };
    return { patch: patchRecord, metadataCommitSha: patchRecord.commit_sha };
  }

  const git = simpleGit(projectRoot);
  const show = await git.show(["--format=%B", "--no-patch", ref]);
  const trailers = parseCommitTrailers(show);
  const patchId = trailers["Spec-Patch-ID"];
  if (!patchId) {
    throw new Error(`commit ${ref} does not contain Spec-Patch-ID trailer`);
  }
  const patch = bundle.sources
    .filter((source) => source.kind === "spec_patch")
    .map((source) => source.path)
    .find((sourcePath) => sourcePath.includes(patchId));
  if (!patch) {
    throw new Error(`SpecPatch ${patchId} not found in spec/evolution`);
  }
  const record = await loadSpecPatchRecord(projectRoot, patch, bundle);
  return {
    patch: {
      ...record.patch,
      commit_sha: await revParse(projectRoot, ref),
    },
    trailers,
    metadataCommitSha: record.patch.commit_sha,
  };
}

async function changedFilesForPatch(projectRoot: string, patch: SpecPatchRecord, ref: string, strict: boolean): Promise<string[]> {
  const git = simpleGit(projectRoot);
  const commit = patch.commit_sha && patch.commit_sha !== "null" ? patch.commit_sha : existsSync(path.resolve(projectRoot, ref)) ? undefined : ref;
  if (!commit) return [];
  try {
    if (!patch.parent_sha || patch.parent_sha === "null") {
      const parents = (await git.raw(["rev-list", "--parents", "-n", "1", commit])).trim().split(/\s+/);
      if (parents.length === 1) {
        const rootDiff = await git.raw(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit]);
        return rootDiff.split(/\r?\n/).map((line) => normalizePath(line)).filter(Boolean);
      }
    }
    const parent = patch.parent_sha && patch.parent_sha !== "null" ? patch.parent_sha : `${commit}^`;
    const diff = await git.diff(["--name-only", `${parent}..${commit}`]);
    return diff.split(/\r?\n/).map((line) => normalizePath(line)).filter(Boolean);
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

function validateStrictPatchRecord(
  projectRoot: string,
  patch: SpecPatchRecord,
  trailers: Record<string, string> | undefined,
  metadataCommitSha: string | undefined,
  strict: boolean,
): SpecDiagnostic[] {
  if (!strict) return [];
  const diagnostics: SpecDiagnostic[] = [];
  void projectRoot;
  if (!metadataCommitSha || metadataCommitSha === "null") {
    diagnostics.push(errorDiagnostic("patch.commit_missing", "SpecPatch apply requires commit_sha", patch.path, patch.id));
  } else if (patch.commit_sha && metadataCommitSha !== patch.commit_sha) {
    diagnostics.push(errorDiagnostic("patch.commit_mismatch", `SpecPatch commit_sha ${metadataCommitSha} does not match resolved commit ${patch.commit_sha}`, patch.path, patch.id));
  }
  if (!patch.parent_sha || patch.parent_sha === "null") {
    diagnostics.push(errorDiagnostic("patch.parent_missing", "SpecPatch apply requires parent_sha", patch.path, patch.id));
  }
  if (trailers) {
    if (trailers["Spec-Patch-ID"] !== patch.id) {
      diagnostics.push(errorDiagnostic("patch.trailer_id_mismatch", `Spec-Patch-ID ${trailers["Spec-Patch-ID"]} does not match ${patch.id}`, patch.path, patch.id));
    }
    const trailerSpecCommit = trailers["Spec-Commit-SHA"];
    if (trailerSpecCommit && patch.spec_commit_sha && trailerSpecCommit !== patch.spec_commit_sha) {
      diagnostics.push(errorDiagnostic("patch.trailer_spec_commit_mismatch", `Spec-Commit-SHA ${trailerSpecCommit} does not match ${patch.spec_commit_sha}`, patch.path, patch.id));
    }
    if (trailerSpecCommit && !patch.spec_commit_sha) {
      diagnostics.push(errorDiagnostic("patch.spec_commit_missing", "SpecPatch YAML must bind spec_commit_sha when commit trailer provides Spec-Commit-SHA", patch.path, patch.id));
    }
  }
  return diagnostics;
}

function validatePatchRecord(bundle: NormalizedSpecBundle, patch: SpecPatchRecord, changedFiles: string[]): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  if (!patch.commit_sha) {
    diagnostics.push(errorDiagnostic("patch.commit_missing", "SpecPatch must bind commit_sha", patch.path, patch.id));
  }
  if (!bundle.architecture.stages.some((stage) => stage.stage === patch.stage)) {
    diagnostics.push(errorDiagnostic("patch.unknown_stage", `SpecPatch stage ${patch.stage} is not in architecture timeline`, patch.path, patch.id));
  }
  const specPaths = new Set(bundle.sources.map((source) => source.path));
  for (const spec of patch.affected_specs) {
    if (!specPaths.has(spec)) {
      diagnostics.push(errorDiagnostic("patch.affected_spec_missing", `affected spec does not exist: ${spec}`, patch.path, spec));
    }
  }
  const moduleIds = new Set(bundle.modules.map((module) => module.module));
  for (const module of patch.affected_modules) {
    if (![...moduleIds].some((candidate) => moduleMatches(candidate, module))) {
      diagnostics.push(errorDiagnostic("patch.affected_module_missing", `affected module does not exist: ${module}`, patch.path, module));
    }
  }
  const opIds = new Set(bundle.operations.map((operation) => operation.id));
  for (const op of patch.affected_operations) {
    if (!opIds.has(op)) {
      diagnostics.push(errorDiagnostic("patch.affected_operation_missing", `affected operation does not exist: ${op}`, patch.path, op));
    }
  }
  const changedSpecs = changedFiles.filter((file) => isSpecYamlPath(file));
  const unlisted = changedSpecs.filter((file) => !patch.affected_specs.includes(file));
  for (const file of unlisted) {
    diagnostics.push(errorDiagnostic("patch.diff_unlisted_spec", `commit changes spec file not listed in affected_specs: ${file}`, patch.path, file));
  }
  if (changedFiles.length > 0) {
    const changedSpecSet = new Set(changedSpecs);
    const stale = patch.affected_specs.filter((file) => !changedSpecSet.has(file));
    for (const file of stale) {
      diagnostics.push(errorDiagnostic("patch.diff_stale_spec", `affected spec is not changed by commit diff: ${file}`, patch.path, file));
    }
  }
  diagnostics.push(...validatePatchDag(bundle.patch_records));
  return diagnostics;
}

function validatePatchDag(patches: SpecPatchRecord[]): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const graph = new Graph({ directed: true });
  diagnostics.push(...duplicates(patches.map((patch) => ({ id: patch.id, path: patch.path })), "patch.duplicate_id"));

  const commits = new Map<string, SpecPatchRecord>();
  const duplicateCommits = new Set<string>();
  for (const patch of patches) {
    if (!patch.commit_sha) continue;
    const first = commits.get(patch.commit_sha);
    if (first) {
      duplicateCommits.add(patch.commit_sha);
      diagnostics.push(errorDiagnostic("patch.commit_duplicate", `duplicate commit_sha ${patch.commit_sha}; first seen at ${first.path}`, patch.path, patch.id));
    } else {
      commits.set(patch.commit_sha, patch);
      graph.setNode(patch.commit_sha);
    }
  }

  for (const patch of patches) {
    if (!patch.commit_sha || duplicateCommits.has(patch.commit_sha)) continue;
    if (!patch.parent_sha || patch.parent_sha === "null") continue;
    if (!commits.has(patch.parent_sha)) {
      if (looksLikeCommitSha(patch.parent_sha)) continue;
      diagnostics.push(errorDiagnostic("patch.parent_missing", `parent_sha does not reference a known SpecPatch commit: ${patch.parent_sha}`, patch.path, patch.id));
      continue;
    }
    graph.setEdge(patch.parent_sha, patch.commit_sha);
  }

  if (!alg.isAcyclic(graph)) {
    diagnostics.push(errorDiagnostic("patch.dag_cycle", "SpecPatch DAG contains a cycle"));
  }
  return diagnostics;
}

function derivePatchImpact(bundle: NormalizedSpecBundle, patch: SpecPatchRecord, changedFiles: string[], strict = false): {
  affected_modules: string[];
  affected_operations: string[];
  diagnostics: SpecDiagnostic[];
} {
  const modules = new Set(patch.affected_modules);
  const operations = new Set(patch.affected_operations);
  const diagnostics: SpecDiagnostic[] = [];

  for (const file of changedFiles.filter((item) => isSpecYamlPath(item))) {
    const modulePath = file.match(/^spec\/modules\/(.+)\/module\.ya?ml$/i);
    if (modulePath) {
      modules.add(modulePath[1]);
      if (!patch.affected_modules.includes(modulePath[1])) {
        diagnostics.push(patchImpactDiagnostic(strict, "patch.impact_unlisted_module", `changed module spec not listed in affected_modules: ${modulePath[1]}`, patch.path, modulePath[1]));
      }
      continue;
    }

    const operation = bundle.operations.find((item) => item.path === file);
    if (operation) {
      modules.add(operation.module);
      operations.add(operation.id);
      if (!patch.affected_modules.some((module) => moduleMatches(operation.module, module))) {
        diagnostics.push(patchImpactDiagnostic(strict, "patch.impact_unlisted_module", `changed operation spec module not listed in affected_modules: ${operation.module}`, patch.path, operation.module));
      }
      if (!patch.affected_operations.includes(operation.id)) {
        diagnostics.push(patchImpactDiagnostic(strict, "patch.impact_unlisted_operation", `changed operation spec not listed in affected_operations: ${operation.id}`, patch.path, operation.id));
      }
    }
  }

  return {
    affected_modules: unique([...modules]),
    affected_operations: unique([...operations]),
    diagnostics,
  };
}

function runSemanticChecks(args: {
  projectRoot: string;
  specRoot: string;
  modules: NormalizedModule[];
  normalizedModules: NormalizedModuleV2[];
  interfaces: NormalizedInterface[];
  design: NormalizedSpecBundle["design"];
  operations: NormalizedOperation[];
  stages: ArchitectureStage[];
  slices: NormalizedSpecBundle["architecture"]["slices"];
  compositions: NormalizedSpecBundle["composition"];
  publicRequirements: NormalizedSpecBundle["verification"]["public_requirements"];
  goals: NormalizedSpecBundle["goals"];
  patchRecords: SpecPatchRecord[];
  manifest?: NormalizedSpecBundle["manifest"];
}): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  diagnostics.push(...validateV2Documents(args));
  if (args.manifest) {
    const stableIds = new Set([
      ...(args.design ? ["design"] : []),
      ...args.normalizedModules.map((module) => module.id),
      ...args.interfaces.map((iface) => iface.id),
      ...args.goals.map((goal) => goal.goal_id),
      ...args.patchRecords.map((patch) => patch.id),
    ]);
    for (const check of args.manifest.checks) {
      if (check.verifies.length === 0) {
        diagnostics.push(errorDiagnostic("manifest.verifies_empty", `test target ${check.id} must verify at least one stable Spec ID`, args.manifest.path, check.id));
      }
      for (const ref of check.verifies) {
        if (!stableIds.has(ref)) {
          diagnostics.push(errorDiagnostic("manifest.verifies_missing", `test target ${check.id} verifies unknown Spec ID ${ref}`, args.manifest.path, ref));
        }
      }
    }
  }
  diagnostics.push(...duplicates(args.modules.map((item) => ({ id: item.id, path: item.path })), "module.duplicate_id"));
  diagnostics.push(...duplicates(args.operations.map((item) => ({ id: item.id, path: item.path })), "operation.duplicate_id"));
  const stages = new Set(args.stages.map((stage) => stage.stage));
  const modules = new Set(args.modules.map((module) => module.module));
  const operations = new Set(args.operations.map((operation) => operation.id));

  for (const module of args.modules) {
    if (!normalizePath(module.path).endsWith("/module.yaml")) continue;
    const expectedPath = `spec/modules/${module.module}/module.yaml`;
    if (normalizePath(module.path) !== expectedPath) {
      diagnostics.push(errorDiagnostic("module.path_mismatch", `module ${module.module} must live at ${expectedPath}`, module.path, module.module));
    }
    if (stages.size > 0 && !stages.has(module.stage)) {
      diagnostics.push(errorDiagnostic("module.unknown_stage", `module stage ${module.stage} is not in architecture timeline`, module.path, module.module));
    }
  }
  for (const op of args.operations) {
    if (!op.path.includes("/ops/")) continue;
    const expectedPrefix = `spec/modules/${op.module}/ops/`;
    if (!op.path.startsWith(expectedPrefix)) {
      diagnostics.push(errorDiagnostic("operation.path_mismatch", `operation ${op.id} must live under ${expectedPrefix}`, op.path, op.id));
    }
    if (stages.size > 0 && !stages.has(op.stage)) {
      diagnostics.push(errorDiagnostic("operation.unknown_stage", `operation stage ${op.stage} is not in architecture timeline`, op.path, op.id));
    }
    if (!modules.has(op.module)) {
      diagnostics.push(errorDiagnostic("operation.module_missing", `operation references missing module ${op.module}`, op.path, op.id));
    }
    for (const requiredModule of op.requires_modules) {
      if (![...modules].some((module) => moduleMatches(module, requiredModule))) {
        diagnostics.push(errorDiagnostic("operation.requires_module_missing", `required module does not exist: ${requiredModule}`, op.path, op.id));
      }
    }
    for (const requiredOp of op.requires_ops) {
      if (!operations.has(requiredOp)) {
        diagnostics.push(errorDiagnostic("operation.requires_op_missing", `required operation does not exist: ${requiredOp}`, op.path, op.id));
      }
    }
    if (op.public_tests.length === 0) {
      diagnostics.push(errorDiagnostic("operation.public_tests_missing", `operation ${op.id} must declare at least one public test obligation`, op.path, op.id));
    }
    for (const target of op.codegen_targets) {
      if (!target.path) {
        diagnostics.push(errorDiagnostic("operation.codegen_target_missing_path", `operation ${op.id} has a codegen target without path`, op.path, op.id));
      }
    }
  }
  diagnostics.push(...validateCompositionRefs(args.compositions, args.modules));
  diagnostics.push(...validatePatchDag(args.patchRecords));
  for (const requirement of args.publicRequirements) {
    if (requirement.related_specs.length === 0 && requirement.required_tests.length === 0) {
      diagnostics.push(errorDiagnostic("verification.requirement_unbound", `public requirement ${requirement.id} has no related specs or required tests`, undefined, requirement.id));
    }
  }
  return diagnostics;
}

function validateV2Documents(args: {
  projectRoot: string;
  normalizedModules: NormalizedModuleV2[];
  interfaces: NormalizedInterface[];
  goals: NormalizedSpecBundle["goals"];
  patchRecords: SpecPatchRecord[];
  design: NormalizedSpecBundle["design"];
  operations: NormalizedOperation[];
}): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const moduleIds = new Set(args.normalizedModules.map((module) => module.module));
  const specIds = new Set<string>();
  if (args.design) specIds.add("design");

  for (const module of args.normalizedModules) {
    if (specIds.has(module.id)) {
      diagnostics.push(errorDiagnostic("spec.duplicate_id", `duplicate stable Spec ID ${module.id}`, module.path, module.id));
    }
    specIds.add(module.id);
    const testOwns = module.owns.filter((owned) => /(^|\/)(?:tests?|testdata)(\/|$)|(?:^|\.)test\.[^/]+$/i.test(normalizePath(owned)));
    const implementationOwns = module.owns.filter((owned) => !testOwns.includes(owned));
    if (testOwns.length === 0) {
      diagnostics.push(errorDiagnostic("module.test_owns_missing", `module ${module.id} owns must include at least one module test path`, module.path, module.id));
    }
    if (implementationOwns.length === 0) {
      diagnostics.push(errorDiagnostic("module.implementation_owns_missing", `module ${module.id} owns must include at least one implementation path`, module.path, module.id));
    }
    for (const owned of module.owns) {
      const normalized = normalizePath(owned);
      const isAbsolute = path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
      const hasTraversal = normalized === ".." || normalized.startsWith("../") || normalized.includes("/../");
      if (isAbsolute || hasTraversal) {
        diagnostics.push(errorDiagnostic("module.owns_path_invalid", `owns path must be repository-relative and cannot traverse: ${owned}`, module.path, module.id));
      }
      const resolved = path.resolve(args.projectRoot, owned);
      const relative = path.relative(args.projectRoot, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        diagnostics.push(errorDiagnostic("module.owns_path_escape", `owns path escapes the project root: ${owned}`, module.path, module.id));
      }
    }
    for (const dependency of module.dependencies) {
      if (![...moduleIds].some((candidate) => moduleMatches(candidate, dependency))) {
        diagnostics.push(errorDiagnostic("module.dependency_missing", `module dependency does not exist: ${dependency}`, module.path, module.id));
      }
    }
    if (module.level < 2) {
      diagnostics.push(warningDiagnostic("module.level_incomplete", `module ${module.id} is L${module.level}; state, pre/postconditions, and invariants are not required`, module.path, module.id));
    }
    if (module.level < 3 && (module.concurrency || module.rely.length > 0 || module.guarantee.length > 0 || module.algorithm_intent)) {
      diagnostics.push(warningDiagnostic("module.level_overdeclared", `module ${module.id} declares L3 fields while level is L${module.level}`, module.path, module.id));
    }
  }

  for (const iface of args.interfaces) {
    if (specIds.has(iface.id)) {
      diagnostics.push(errorDiagnostic("spec.duplicate_id", `duplicate stable Spec ID ${iface.id}`, iface.path, iface.id));
    }
    specIds.add(iface.id);
    if (iface.module && ![...moduleIds].some((candidate) => moduleMatches(candidate, iface.module!))) {
      diagnostics.push(errorDiagnostic("interface.module_missing", `interface references missing module ${iface.module}`, iface.path, iface.id));
    }
    if (iface.operations.length === 0) {
      diagnostics.push(errorDiagnostic("interface.operations_missing", `interface ${iface.id} must declare at least one operation`, iface.path, iface.id));
    }
  }

  for (const goal of args.goals) {
    if (specIds.has(goal.goal_id)) {
      diagnostics.push(errorDiagnostic("spec.duplicate_id", `duplicate stable Spec ID ${goal.goal_id}`, goal.path, goal.goal_id));
    }
    specIds.add(goal.goal_id);
  }
  for (const patch of args.patchRecords) {
    if (specIds.has(patch.id)) {
      diagnostics.push(errorDiagnostic("spec.duplicate_id", `duplicate stable Spec ID ${patch.id}`, patch.path, patch.id));
    }
    specIds.add(patch.id);
  }

  const opIds = new Set<string>();
  for (const operation of args.operations) {
    if (opIds.has(operation.id)) {
      diagnostics.push(errorDiagnostic("operation.duplicate_id", `duplicate stable operation ID ${operation.id}`, operation.path, operation.id));
    }
    opIds.add(operation.id);
  }
  return diagnostics;
}

function validateCompositionRefs(
  compositions: NormalizedSpecBundle["composition"],
  modules: NormalizedModule[],
): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  const moduleIds = modules.map((module) => module.module);
  for (const composition of compositions) {
    if (composition.affected_modules.length === 0) {
      diagnostics.push(errorDiagnostic("composition.affected_modules_missing", `composition ${composition.id} must declare affected_modules`, composition.path, composition.id));
    }
    for (const module of composition.affected_modules) {
      if (!moduleIds.some((candidate) => moduleMatches(candidate, module))) {
        diagnostics.push(errorDiagnostic("composition.module_missing", `composition references missing module ${module}`, composition.path, composition.id));
      }
    }
  }
  return diagnostics;
}

function classifySpecFile(relPath: string): SpecDocumentKind {
  const rel = normalizePath(relPath);
  if (rel === "spec/design.yaml") return "design";
  if (rel.startsWith("spec/interfaces/") && (rel.endsWith(".yaml") || rel.endsWith(".yml"))) return "interface";
  if (rel.startsWith("spec/modules/") && (rel.endsWith(".yaml") || rel.endsWith(".yml")) && !rel.includes("/ops/")) {
    if (!rel.endsWith("/module.yaml") && !rel.endsWith("/concurrency.yaml") && !rel.endsWith("/tests.yaml")) return "module";
  }
  if (rel.startsWith("spec/patches/") && (rel.endsWith(".yaml") || rel.endsWith(".yml"))) return "spec_patch";
  if (rel.startsWith("spec/qemu/") && (rel.endsWith(".yaml") || rel.endsWith(".yml"))) return "qemu_port";
  if (rel.startsWith("spec/modules/") && rel.endsWith("/module.yaml")) return "module";
  if (rel.startsWith("spec/modules/") && rel.includes("/ops/")) return "operation";
  if (rel.startsWith("spec/modules/") && rel.endsWith("/concurrency.yaml")) return "concurrency";
  if (rel.startsWith("spec/modules/") && rel.endsWith("/tests.yaml")) return "module_tests";
  if (rel === "spec/architecture/seed.yaml") return "architecture_seed";
  if (rel === "spec/architecture/timeline.yaml") return "architecture_timeline";
  if (rel === "spec/architecture/composition.yaml") return "architecture_composition";
  if (rel.startsWith("spec/architecture/slices/")) return "architecture_slice";
  if (rel.startsWith("spec/architecture/decisions/")) return "adr";
  if (rel.startsWith("spec/composition/")) return "composition";
  if (rel.startsWith("spec/goals/")) return "goal";
  if (rel.startsWith("spec/evolution/")) return "spec_patch";
  if (rel === "spec/verification/public-matrix.yaml") return "verification_public_matrix";
  if (rel.startsWith("spec/toolchain/")) return "toolchain";
  return "unknown";
}

function duplicates(values: Array<{ id: string; path?: string }>, code: string): SpecDiagnostic[] {
  const seen = new Map<string, string | undefined>();
  const out: SpecDiagnostic[] = [];
  for (const value of values) {
    const first = seen.get(value.id);
    if (first !== undefined) {
      out.push(errorDiagnostic(code, `duplicate id ${value.id}; first seen at ${first}`, value.path, value.id));
    } else {
      seen.set(value.id, value.path ?? "");
    }
  }
  return out;
}

function parseCommitTrailers(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of message.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

function warningDiagnostic(code: string, message: string, pathValue?: string, ref?: string): SpecDiagnostic {
  return { severity: "warning", code, message, path: pathValue, ref };
}

function patchImpactDiagnostic(strict: boolean, code: string, message: string, pathValue?: string, ref?: string): SpecDiagnostic {
  return strict ? errorDiagnostic(code, message, pathValue, ref) : warningDiagnostic(code, message, pathValue, ref);
}

function looksLikeCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

async function revParse(projectRoot: string, ref: string): Promise<string> {
  const git = simpleGit(projectRoot);
  return (await git.revparse([ref])).trim();
}
