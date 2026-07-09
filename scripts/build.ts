import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDir = path.join(rootDir, "vos");
const versionFile = path.join(workspaceDir, "packages", "vos-core", "src", "version.generated.ts");
const entryPoint = path.join("apps", "vos-cli", "app", "main.ts");
const outputFile = path.join("..", "dist", "vos.exe");

async function main(): Promise<void> {
    if (!existsSync(path.join(workspaceDir, "package.json"))) {
        throw new Error("vos workspace is missing; run the build from the VeriSpecOSLab repository root.");
    }

    await ensureWorkspaceDependencies();

    const previousVersion = await readFile(versionFile, "utf8").catch(() => undefined);
    const gitHash = await resolveGitHash();
    await writeFile(versionFile, `export const COMMAND_VERSION = ${JSON.stringify(gitHash)};\n`, "utf8");

    try {
        const result = Bun.spawnSync([process.execPath, "build", entryPoint, "--compile", "--outfile", outputFile], {
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
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
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