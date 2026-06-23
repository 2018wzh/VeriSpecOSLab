import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveToolchainManifestPath } from "./toolchain-manifest.ts";

const commandArraySchema = z.array(z.string()).min(1);

const toolchainCommandSchema = z.object({
  name: z.string().min(1).optional(),
  command: commandArraySchema,
  cwd: z.string().optional(),
  timeoutMs: z.number().nonnegative().optional(),
  timeout_ms: z.number().nonnegative().optional(),
});

const buildVariantSchema = z.object({
  id: z.string().min(1),
  purpose: z.string().optional(),
  features: z.array(z.string()).optional(),
  defines: z.array(z.string()).optional(),
  test_only: z.boolean().optional(),
  commands: z.array(z.union([z.string(), toolchainCommandSchema])).min(1),
  artifacts: z.array(z.string()).optional(),
});

const endpointSchema = z.union([
  z.boolean(),
  z.object({
    enabled: z.boolean().optional(),
    path: z.string().optional(),
    port: z.number().int().positive().optional(),
  }),
]).optional();

const runProfileSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  artifacts: z.array(z.string()).default([]),
  timeout_ms: z.number().nonnegative().optional(),
  timeout_secs: z.number().nonnegative().optional(),
  serial: endpointSchema,
  qmp: endpointSchema,
  hmp: endpointSchema,
  gdb: endpointSchema,
  resource_lock: z.string().optional(),
});

const runCaseSchema = z.object({
  id: z.string().min(1),
  profile: z.string().optional(),
  stdin: z.string().optional(),
  stdin_after: z.object({
    pattern: z.string(),
    text: z.string(),
  }).optional(),
  success_regex: z.string().optional(),
  failure_regex: z.string().optional(),
  exit_code: z.number().int().optional(),
  timeout_ms: z.number().nonnegative().optional(),
  required_artifacts: z.array(z.string()).default([]),
  expected_qmp_events: z.array(z.string()).default([]),
});

const commandSuiteSchema = z.object({
  name: z.string().min(1),
  kind: z.literal("command"),
  command: commandArraySchema,
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout_ms: z.number().nonnegative().optional(),
  build_variant: z.string().optional(),
  related_specs: z.array(z.string()).default([]),
});

const qemuSuiteSchema = z.object({
  name: z.string().min(1),
  kind: z.literal("qemu-case"),
  run_case: z.string().min(1),
  build_variant: z.string().min(1),
  timeout_ms: z.number().nonnegative().optional(),
  related_specs: z.array(z.string()).default([]),
});

const testSuiteSchema = z.discriminatedUnion("kind", [commandSuiteSchema, qemuSuiteSchema]);

const manifestSchema = z.object({
  manifest_version: z.literal(2),
  spec_hash: z.string().optional(),
  spec_path: z.string().optional(),
  files: z.array(z.string()).default([]),
  generator: z.object({
    name: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
  build: z.object({
    variants: z.array(buildVariantSchema).min(1),
  }),
  run: z.object({
    profiles: z.array(runProfileSchema).min(1),
    cases: z.array(runCaseSchema).min(1),
  }),
  test: z.object({
    suites: z.array(testSuiteSchema),
  }),
  verify: z.object({
    full: z.array(z.string()).optional(),
    generated: z.record(z.string(), z.array(z.string())).optional(),
    invariant: z.record(z.string(), z.array(z.string())).optional(),
    fuzz: z.record(z.string(), z.array(z.string())).optional(),
  }).optional(),
  projection_version: z.string().optional(),
}).strict();

export type ToolchainManifestV2 = z.infer<typeof manifestSchema>;
export type ToolchainCommandV2 = z.infer<typeof toolchainCommandSchema>;
export type BuildVariantV2 = z.infer<typeof buildVariantSchema>;
export type RunProfileV2 = z.infer<typeof runProfileSchema>;
export type RunCaseV2 = z.infer<typeof runCaseSchema>;
export type TestSuiteV2 = z.infer<typeof testSuiteSchema>;

export async function loadToolchainManifest(params: {
  projectRoot: string;
  toolchainPath?: string;
}): Promise<{ path: string; manifest: ToolchainManifestV2 }> {
  const manifestPath = await resolveToolchainManifestPath(params);
  if (!existsSync(manifestPath)) {
    throw new Error(`toolchain manifest v2 required at ${manifestPath}`);
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid toolchain manifest v2: ${z.prettifyError(parsed.error)}`);
  }
  validateManifestReferences(parsed.data);
  return { path: manifestPath, manifest: parsed.data };
}

export function parseToolchainManifest(value: unknown): ToolchainManifestV2 {
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`invalid toolchain manifest v2: ${z.prettifyError(parsed.error)}`);
  }
  validateManifestReferences(parsed.data);
  return parsed.data;
}

export function getBuildVariant(manifest: ToolchainManifestV2, variantId = "baseline"): BuildVariantV2 {
  const variant = manifest.build.variants.find((candidate) => candidate.id === variantId);
  if (!variant) throw new Error(`unknown build variant: ${variantId}`);
  return variant;
}

export function getTestSuite(manifest: ToolchainManifestV2, suiteName: string): TestSuiteV2 {
  const suite = manifest.test.suites.find((candidate) => candidate.name === suiteName);
  if (!suite) throw new Error(`unknown test suite: ${suiteName}`);
  return suite;
}

export function normalizeManifestPath(projectRoot: string, raw?: string): string | undefined {
  return raw ? path.resolve(projectRoot, raw) : undefined;
}

function validateManifestReferences(manifest: ToolchainManifestV2): void {
  const variants = new Set<string>();
  for (const variant of manifest.build.variants) {
    if (variants.has(variant.id)) throw new Error(`duplicate build variant: ${variant.id}`);
    variants.add(variant.id);
  }
  if (!variants.has("baseline")) throw new Error("toolchain manifest requires build variant: baseline");

  const profiles = new Set<string>();
  for (const profile of manifest.run.profiles) {
    if (profiles.has(profile.id)) throw new Error(`duplicate run profile: ${profile.id}`);
    profiles.add(profile.id);
  }
  const cases = new Set<string>();
  for (const runCase of manifest.run.cases) {
    if (cases.has(runCase.id)) throw new Error(`duplicate run case: ${runCase.id}`);
    cases.add(runCase.id);
    if (runCase.profile && !profiles.has(runCase.profile)) throw new Error(`run case ${runCase.id} references unknown profile: ${runCase.profile}`);
  }

  const suites = new Set<string>();
  for (const suite of manifest.test.suites) {
    if (suites.has(suite.name)) throw new Error(`duplicate test suite: ${suite.name}`);
    suites.add(suite.name);
    if (suite.build_variant && !variants.has(suite.build_variant)) throw new Error(`test suite ${suite.name} references unknown build variant: ${suite.build_variant}`);
    if (suite.kind === "qemu-case" && !cases.has(suite.run_case)) throw new Error(`test suite ${suite.name} references unknown run case: ${suite.run_case}`);
  }

  for (const [scope, mapping] of Object.entries({
    generated: manifest.verify?.generated,
    invariant: manifest.verify?.invariant,
    fuzz: manifest.verify?.fuzz,
  })) {
    for (const [obligation, mappedSuites] of Object.entries(mapping ?? {})) {
      for (const suite of mappedSuites) {
        if (!suites.has(suite)) throw new Error(`verify.${scope}.${obligation} references unknown test suite: ${suite}`);
      }
    }
  }
  for (const suite of manifest.verify?.full ?? []) {
    if (!suites.has(suite)) throw new Error(`verify.full references unknown test suite: ${suite}`);
  }
}
