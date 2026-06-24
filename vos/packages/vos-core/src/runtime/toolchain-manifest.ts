import { existsSync } from "node:fs";
import path from "node:path";

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

  return manifestPath;
}

export async function hasResolvableToolchainManifest(projectRoot: string): Promise<boolean> {
  const manifestPath = await resolveToolchainManifestPath({ projectRoot });
  return existsSync(manifestPath);
}
