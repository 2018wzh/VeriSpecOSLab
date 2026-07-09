/// <reference path="./globals.d.ts" />

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const workspaceDir = path.join(rootDir, "vos");
const versionFile = path.join(workspaceDir, "packages", "vos-core", "src", "version.generated.ts");
const entryPoint = path.join("apps", "vos-cli", "app", "main.ts");

export interface BuildSettings {
    outputFile: string;
    buildArgs: string[];
}

export function resolveBuildSettings(
    env: Record<string, string | undefined> = process.env,
    platform: NodeJS.Platform = process.platform,
): BuildSettings {
    const defaultOutput = path.join("..", "dist", platform === "win32" ? "vos.exe" : "vos");
    const outputFile = env.VOS_BUILD_OUTFILE
        ? path.relative(workspaceDir, path.resolve(rootDir, env.VOS_BUILD_OUTFILE))
        : defaultOutput;
    const buildArgs = ["build", entryPoint, "--compile", "--outfile", outputFile];
    if (env.VOS_BUILD_TARGET) {
        buildArgs.push(`--target=${env.VOS_BUILD_TARGET}`);
    }
    return { outputFile, buildArgs };
}

export function resolveCommandVersion(gitHash: string, env: Record<string, string | undefined> = process.env): string {
    return env.VOS_COMMAND_VERSION?.trim() || gitHash;
}

async function main(): Promise<void> {
    if (!existsSync(path.join(workspaceDir, "package.json"))) {
        throw new Error("vos workspace is missing; run the build from the VeriSpecOSLab repository root.");
    }

    await ensureWorkspaceDependencies();

    const previousVersion = await readFile(versionFile, "utf8").catch(() => undefined);
    const gitHash = await resolveGitHash();
    await writeFile(versionFile, `export const COMMAND_VERSION = ${JSON.stringify(resolveCommandVersion(gitHash))};\n`, "utf8");

    try {
        const settings = resolveBuildSettings();
        await mkdir(path.dirname(path.resolve(workspaceDir, settings.outputFile)), { recursive: true });
        const result = Bun.spawnSync([process.execPath, ...settings.buildArgs], {
            cwd: workspaceDir,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        });
        if (result.exitCode !== 0) {
            process.exit(result.exitCode ?? 1);
        }
    } finally {
        if (previousVersion !== undefined) {
            await writeFile(versionFile, previousVersion, "utf8");
        }
    }
}

async function ensureWorkspaceDependencies(): Promise<void> {
    const bunMarker = path.join(workspaceDir, "node_modules", ".bun");
    if (existsSync(bunMarker)) {
        return;
    }

    const install = Bun.spawnSync([process.execPath, "install"], {
        cwd: workspaceDir,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    if (install.exitCode !== 0) {
        throw new Error("workspace dependency installation failed during build bootstrap");
    }
}

async function resolveGitHash(): Promise<string> {
    const result = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], {
        cwd: rootDir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
    });
    if (result.exitCode !== 0) {
        throw new Error("unable to resolve git commit hash for version metadata");
    }
    return new TextDecoder().decode(result.stdout).trim();
}

if (import.meta.main) {
    await main();
}
