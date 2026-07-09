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
  architectureSliceSchema,
  compositionSchema,
  goalSchema,
  moduleSchema,
  operationSchema,
  publicMatrixSchema,
  seedSchema,
  specPatchSchema,
  timelineSchema,
} from "./schemas.ts";
import type {
  AgentSpecReview,
  ArchitectureCompositionReport,
  ArchitectureStage,
  DerivedTestMatrix,
  NormalizedModule,
  NormalizedOperation,
  NormalizedSpecBundle,
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
  NormalizedOperation,
  NormalizedSpecBundle,
  PatchImpactReport,
  SpecDiagnostic,
  SpecDocumentKind,
  SpecPatchRecord,
  SpecSource,
} from "./types.ts";

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
  const operations: NormalizedOperation[] = [];
  const stages: ArchitectureStage[] = [];
  const slices: NormalizedSpecBundle["architecture"]["slices"] = [];
  const decisions: NormalizedSpecBundle["architecture"]["decisions"] = [];
  const compositions: NormalizedSpecBundle["composition"] = [];
  const goals: NormalizedSpecBundle["goals"] = [];
  const toolchainProfiles: NormalizedSpecBundle["toolchain_profiles"] = [];
  const publicRequirements: NormalizedSpecBundle["verification"]["public_requirements"] = [];
  const patchRecords: SpecPatchRecord[] = [];
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
      if (kind === "module") {
        const doc = moduleSchema.parse(parsed);
        modules.push({
          id: doc.id,
          module: doc.module,
          stage: doc.stage,
          path: rel,
          purpose: doc.purpose,
          related_slices: doc.related_slices,
          related_adrs: doc.related_adrs,
          test_surfaces: doc.test_surfaces,
        });
      } else if (kind === "operation") {
        const doc = operationSchema.parse(parsed);
        operations.push({
          id: doc.id,
          module: doc.module,
          operation: doc.operation,
          stage: doc.stage,
          path: rel,
          related_slice: doc.related_slice ?? undefined,
          related_adr: doc.related_adr ?? undefined,
          requires_modules: doc.depends_on.requires_modules,
          requires_ops: doc.depends_on.requires_ops,
          public_tests: doc.test_obligations.public,
          generated_tests: doc.test_obligations.generated,
          hidden_tags: doc.test_obligations.hidden_tags,
          codegen_targets: doc.codegen.targets,
          invariants_preserved: doc.invariants_preserved,
          required_followup_checks: doc.codegen.required_followup_checks,
        });
      } else if (kind === "architecture_timeline") {
        const doc = timelineSchema.parse(parsed);
        for (const item of doc.timeline) {
          if (!item.stage) continue;
          stages.push({
            stage: item.stage,
            slice: item.slice,
            title: item.title,
            enabled_modules: item.enabled_modules,
            validation_gate: item.validation_gate,
          });
        }
      } else if (kind === "architecture_slice") {
        const doc = architectureSliceSchema.parse(parsed);
        slices.push({
          id: doc.id,
          stage: doc.stage,
          path: rel,
          enabled_modules: doc.enabled_modules,
          validation_gate: doc.validation_gate,
        });
      } else if (kind === "adr") {
        const id = typeof parsed.id === "string" ? parsed.id : path.basename(rel, path.extname(rel));
        decisions.push({ id, path: rel });
      } else if (kind === "composition") {
        const doc = compositionSchema.parse(parsed);
        compositions.push({
          id: doc.id,
          title: doc.title,
          path: rel,
          affected_modules: doc.affected_modules,
          tests: unique(doc.cross_component_rules.flatMap((rule) => rule.tests)),
        });
      } else if (kind === "goal") {
        const doc = goalSchema.parse(parsed);
        goals.push({
          goal_id: doc.goal_id,
          category: doc.category,
          path: rel,
          evidence_required: doc.evidence_required,
        });
      } else if (kind === "verification_public_matrix") {
        const doc = publicMatrixSchema.parse(parsed);
        publicRequirements.push(...doc.public_requirements.map((req) => ({
          id: req.id,
          related_specs: req.related_specs,
          required_tests: req.required_tests,
          required_artifacts: req.required_artifacts,
        })));
      } else if (kind === "architecture_seed") {
        // v2: seed.yaml uses lenient schema — blank/TODO fields are allowed.
        // Only report diagnostics for malformed values (wrong types), not missing fields.
        const doc = seedSchema.parse(parsed);
        seedDoc = doc as Record<string, unknown>;
      } else if (kind === "spec_patch") {
        const doc = specPatchSchema.parse(parsed);
        patchRecords.push({
          id: doc.id,
          stage: doc.stage,
          title: doc.title,
          kind: doc.kind,
          path: rel,
          commit_sha: doc.commit_sha ?? undefined,
          parent_sha: doc.parent_sha ?? undefined,
          spec_commit_sha: doc.spec_commit_sha ?? undefined,
          affected_specs: doc.affected_specs,
          affected_modules: doc.affected_modules,
          affected_operations: doc.affected_operations,
          required_regressions: doc.required_regressions,
        });
      } else if (kind === "toolchain") {
        toolchainProfiles.push({
          path: rel,
          id: typeof parsed.id === "string" ? parsed.id : undefined,
          includes: Array.isArray(parsed.includes) ? parsed.includes.filter(isString) : [],
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

  diagnostics.push(...runSemanticChecks({ projectRoot, specRoot, modules, operations, stages, slices, compositions, publicRequirements, patchRecords }));
  return {
    version: "vos-spec.bundle.v1",
    spec_root: normalizePath(path.relative(projectRoot, specRoot)) || "spec",
    generated_at: new Date().toISOString(),
    sources: sources.sort(byPath),
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
    toolchain_profiles: toolchainProfiles.sort(byPath),
    verification: {
      public_requirements: publicRequirements.sort(byId),
    },
    hashes,
    visibility: Object.fromEntries(sources.map((source) => [source.path, inferVisibility(source.path)])),
    diagnostics,
  };
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

export function composeArchitecture(bundle: NormalizedSpecBundle, targetStage?: string): ArchitectureCompositionReport {
  const stage = targetStage ?? bundle.architecture.stages.at(-1)?.stage ?? "";
  const stageIndex = bundle.architecture.stages.findIndex((item) => item.stage === stage);
  const activeStages = stageIndex >= 0 ? bundle.architecture.stages.slice(0, stageIndex + 1) : bundle.architecture.stages;
  const modulesFromStages = activeStages.flatMap((item) => item.enabled_modules);
  const modulesFromSlices = bundle.architecture.slices
    .filter((slice) => !slice.stage || activeStages.some((item) => item.stage === slice.stage || item.slice === slice.id))
    .flatMap((slice) => slice.enabled_modules);
  const enabledModules = expandModuleRefs(unique([...modulesFromStages, ...modulesFromSlices]), bundle.modules);
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
    const parsed = specPatchSchema.parse(parseYaml(raw));
    const patchRecord = {
      id: parsed.id,
      stage: parsed.stage,
      title: parsed.title,
      kind: parsed.kind,
      path: rel,
      commit_sha: parsed.commit_sha ?? undefined,
      parent_sha: parsed.parent_sha ?? undefined,
      spec_commit_sha: parsed.spec_commit_sha ?? undefined,
      affected_specs: parsed.affected_specs,
      affected_modules: parsed.affected_modules,
      affected_operations: parsed.affected_operations,
      required_regressions: parsed.required_regressions,
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
  operations: NormalizedOperation[];
  stages: ArchitectureStage[];
  slices: NormalizedSpecBundle["architecture"]["slices"];
  compositions: NormalizedSpecBundle["composition"];
  publicRequirements: NormalizedSpecBundle["verification"]["public_requirements"];
  patchRecords: SpecPatchRecord[];
}): SpecDiagnostic[] {
  const diagnostics: SpecDiagnostic[] = [];
  diagnostics.push(...duplicates(args.modules.map((item) => ({ id: item.id, path: item.path })), "module.duplicate_id"));
  diagnostics.push(...duplicates(args.operations.map((item) => ({ id: item.id, path: item.path })), "operation.duplicate_id"));
  const stages = new Set(args.stages.map((stage) => stage.stage));
  const modules = new Set(args.modules.map((module) => module.module));
  const operations = new Set(args.operations.map((operation) => operation.id));

  for (const module of args.modules) {
    const expectedPath = `spec/modules/${module.module}/module.yaml`;
    if (normalizePath(module.path) !== expectedPath) {
      diagnostics.push(errorDiagnostic("module.path_mismatch", `module ${module.module} must live at ${expectedPath}`, module.path, module.module));
    }
    if (stages.size > 0 && !stages.has(module.stage)) {
      diagnostics.push(errorDiagnostic("module.unknown_stage", `module stage ${module.stage} is not in architecture timeline`, module.path, module.module));
    }
  }
  for (const op of args.operations) {
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
