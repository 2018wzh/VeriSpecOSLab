import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectStringListByKey,
  isRecord,
  parseTopLevelYaml,
} from "../utils/yaml.ts";

interface MaterializedManifest {
  generator: {
    name: string;
    version: string;
    source: string;
  };
  files: string[];
  build: {
    commands: string[];
    artifacts: string[];
  };
  run: {
    command?: string;
    successSignal?: string;
    artifact?: string;
    timeout_secs?: number;
  };
}

interface BuildEntrypoint {
  files: string[];
  commands: string[];
}

export async function resolveToolchainManifestPath(params: {
  projectRoot: string;
  toolchainPath?: string;
}): Promise<string> {
  if (params.toolchainPath) {
    return path.resolve(params.toolchainPath);
  }

  const manifestPath = path.resolve(params.projectRoot, ".vos", "toolchain.json");
  if (existsSync(manifestPath)) {
    return manifestPath;
  }

  await materializeDefaultManifest(params.projectRoot, manifestPath);
  return manifestPath;
}

export async function hasResolvableToolchainManifest(projectRoot: string): Promise<boolean> {
  const manifestPath = await resolveToolchainManifestPath({ projectRoot });
  return existsSync(manifestPath);
}

async function materializeDefaultManifest(
  projectRoot: string,
  manifestPath: string,
): Promise<void> {
  const buildSpecPath = path.join(projectRoot, "spec", "toolchain", "build.yaml");
  if (!existsSync(buildSpecPath)) return;

  const buildSpec = parseTopLevelYaml(await readFile(buildSpecPath, "utf8"));
  const allowedOutputPaths = collectStringListByKey(buildSpec, "allowed_output_path");
  const entrypoint = detectBuildEntrypoint(projectRoot, allowedOutputPaths);
  if (!entrypoint) return;

  const buildArtifacts = collectStringListByKey(buildSpec, "generated_artifacts");
  const runSpec = await readRunSpec(projectRoot);
  const artifact = runSpec.artifact
    ?? buildArtifacts.find((value) => value.endsWith(".bin"))
    ?? buildArtifacts.find((value) => value.endsWith(".elf"))
    ?? "build/kernel.bin";
  const manifest: MaterializedManifest = {
    generator: {
      name: "vos-cli",
      version: "default-toolchain-manifest",
      source: "spec/toolchain/build.yaml",
    },
    files: entrypoint.files,
    build: {
      commands: entrypoint.commands,
      artifacts: buildArtifacts.length > 0 ? buildArtifacts : [artifact],
    },
    run: {
      command: runSpec.command,
      successSignal: runSpec.successSignal,
      artifact,
      timeout_secs: runSpec.timeoutSecs,
    },
  };

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function detectBuildEntrypoint(
  projectRoot: string,
  allowedOutputPaths: string[],
): BuildEntrypoint | undefined {
  if (isAllowedGeneratedPath("Makefile", allowedOutputPaths) && existsSync(path.join(projectRoot, "Makefile"))) {
    return {
      files: ["Makefile"],
      commands: ["make all"],
    };
  }

  if (isAllowedGeneratedPath("CMakeLists.txt", allowedOutputPaths) && existsSync(path.join(projectRoot, "CMakeLists.txt"))) {
    return {
      files: ["CMakeLists.txt"],
      commands: ["cmake -S . -B build", "cmake --build build"],
    };
  }

  if (isAllowedGeneratedPath("xtask/Cargo.toml", allowedOutputPaths) && existsSync(path.join(projectRoot, "xtask", "Cargo.toml"))) {
    const files = ["xtask/Cargo.toml"];
    if (isAllowedGeneratedPath("xtask/src/tasks.rs", allowedOutputPaths) && existsSync(path.join(projectRoot, "xtask", "src", "tasks.rs"))) {
      files.push("xtask/src/tasks.rs");
    }
    return {
      files,
      commands: ["cargo run --manifest-path xtask/Cargo.toml -- build"],
    };
  }

  return undefined;
}

function isAllowedGeneratedPath(candidate: string, allowedOutputPaths: string[]): boolean {
  if (allowedOutputPaths.length === 0) return false;
  const normalized = normalizePath(candidate);
  return allowedOutputPaths.some((allowed) => {
    const prefix = normalizePath(allowed);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}

async function readRunSpec(projectRoot: string): Promise<{
  command?: string;
  successSignal?: string;
  artifact?: string;
  timeoutSecs?: number;
}> {
  const runSpecPath = path.join(projectRoot, "spec", "toolchain", "run.yaml");
  if (!existsSync(runSpecPath)) return {};

  const parsed = parseTopLevelYaml(await readFile(runSpecPath, "utf8"));
  if (!isRecord(parsed.run)) return {};
  const rawRun = parsed.run;
  return {
    command: stringValue(rawRun.command) ?? stringValue(rawRun.emulator),
    successSignal: stringValue(rawRun.success_signal) ?? stringValue(rawRun.successSignal),
    artifact: stringValue(rawRun.kernel_path) ?? stringValue(rawRun.artifact),
    timeoutSecs: numberValue(rawRun.timeout_secs) ?? numberValue(rawRun.timeoutSecs),
  };
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
