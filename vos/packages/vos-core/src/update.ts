import { COMMAND_VERSION } from "./version.ts";
import { chmodSync, copyFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export type UpdateChannel = "stable" | "nightly";

export interface UpdateTarget {
    channel: UpdateChannel;
    currentVersion: string;
    latestVersion?: string;
    available: boolean;
    assetName?: string;
    downloadUrl?: string;
}

const REPO_OWNER = "2018wzh";
const REPO_NAME = "VeriSpecOSLab";

export function detectUpdateTarget(channel: UpdateChannel = resolveUpdateChannel(), currentVersion = COMMAND_VERSION): UpdateTarget {
    const assetName = resolveAssetName(channel);
    return {
        channel,
        currentVersion,
        available: false,
        assetName,
    };
}

export async function maybeCheckForUpdate(currentVersion = COMMAND_VERSION): Promise<UpdateTarget | null> {
    if (process.env.VOS_NO_AUTO_UPDATE === "1") {
        return null;
    }

    const channel = resolveUpdateChannel();
    const target = detectUpdateTarget(channel, currentVersion);
    const latest = await fetchLatestRelease(channel).catch(() => null);
    if (!latest) {
        return null;
    }

    target.latestVersion = latest.tag_name;
    target.available = latest.tag_name !== currentVersion;
    target.downloadUrl = latest.assets.find((asset) => asset.name === target.assetName)?.browser_download_url;

    if (target.available && target.downloadUrl) {
        console.error(`vos: update available (${latest.tag_name}); current ${currentVersion}. Download: ${target.downloadUrl}`);
    }

    return target;
}

export async function performSelfUpdate(currentVersion = COMMAND_VERSION): Promise<UpdateTarget> {
    const channel = resolveUpdateChannel();
    const target = detectUpdateTarget(channel, currentVersion);
    const latest = await fetchLatestRelease(channel);
    if (!latest) {
        throw new Error(`unable to resolve the latest ${channel} release from GitHub`);
    }

    target.latestVersion = latest.tag_name;
    target.available = latest.tag_name !== currentVersion;
    if (!target.available) {
        return target;
    }
    target.downloadUrl = latest.assets.find((asset) => asset.name === target.assetName)?.browser_download_url;
    if (!target.downloadUrl) {
        throw new Error(`no downloadable asset named ${target.assetName} was found for ${latest.tag_name}`);
    }

    const downloadedPath = await downloadAsset(target.downloadUrl, target.assetName ?? "vos-update");
    await installDownloadedBinary(downloadedPath);
    return target;
}

async function fetchLatestRelease(channel: UpdateChannel): Promise<ReleaseRecord | null> {
    const response = await fetch(releaseEndpoint(channel), {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
        return null;
    }

    const payload = (await response.json()) as unknown;
    if (channel === "stable") {
        return isReleaseRecord(payload) ? payload : null;
    }

    if (!Array.isArray(payload)) {
        return null;
    }

    return payload.find((release): release is ReleaseRecord => isReleaseRecord(release) && release.prerelease === true) ?? null;
}

function releaseEndpoint(channel: UpdateChannel): string {
    if (channel === "stable") {
        return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    }
    return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=10`;
}

function resolveUpdateChannel(): UpdateChannel {
    return process.env.VOS_UPDATE_CHANNEL === "nightly" ? "nightly" : "stable";
}

function resolveAssetName(channel: UpdateChannel): string {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "win32") {
        return `vos-windows-${arch}.exe`;
    }
    if (platform === "darwin") {
        return `vos-macos-${arch}`;
    }
    if (platform === "linux") {
        return `vos-linux-${arch}`;
    }
    return `vos-${channel}-${platform}-${arch}`;
}

interface ReleaseRecord {
    tag_name: string;
    prerelease: boolean;
    assets: Array<{ name: string; browser_download_url: string }>;
}

function isReleaseRecord(value: unknown): value is ReleaseRecord {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as { tag_name?: unknown; prerelease?: unknown; assets?: unknown };
    return typeof record.tag_name === "string" && typeof record.prerelease === "boolean" && Array.isArray(record.assets);
}

async function downloadAsset(downloadUrl: string, assetName: string): Promise<string> {
    const response = await fetch(downloadUrl, {
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) {
        throw new Error(`failed to download update asset from ${downloadUrl}`);
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), "vos-update-"));
    const targetPath = path.join(tempDir, assetName);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) {
        throw new Error(`downloaded update asset from ${downloadUrl} was empty`);
    }
    writeFileSync(targetPath, bytes);
    if (process.platform !== "win32") {
        chmodSync(targetPath, 0o755);
    }
    return targetPath;
}

async function installDownloadedBinary(downloadedPath: string): Promise<void> {
    const currentBinary = process.execPath;
    if (process.platform === "win32") {
        await scheduleWindowsReplacement(currentBinary, downloadedPath);
        return;
    }

    const backupPath = `${currentBinary}.old`;
    try {
        copyFileSync(currentBinary, backupPath);
    } catch {
        // best-effort backup only
    }

    try {
        renameSync(downloadedPath, currentBinary);
    } catch (error) {
        try {
            copyFileSync(downloadedPath, currentBinary);
            chmodSync(currentBinary, 0o755);
        } catch (fallbackError) {
            try {
                unlinkSync(backupPath);
            } catch {
                // ignore cleanup failure
            }
            throw fallbackError instanceof Error ? fallbackError : error;
        }
    }
}

async function scheduleWindowsReplacement(currentBinary: string, downloadedPath: string): Promise<void> {
    const script = [
        "$target = $args[0]",
        "$source = $args[1]",
        `$pid = ${process.pid}`,
        "while (Get-Process -Id $pid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }",
        "$retry = 0",
        "while ($retry -lt 20) {",
        "  try {",
        "    Copy-Item -Force $source $target",
        "    break",
        "  } catch {",
        "    Start-Sleep -Milliseconds 250",
        "    $retry++",
        "  }",
        "}",
    ].join("; ");

    const result = Bun.spawnSync([
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
        currentBinary,
        downloadedPath,
    ], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
    });
    if (result.exitCode !== 0) {
        throw new Error("Windows self-update handoff failed; please replace the binary manually with the downloaded asset");
    }
}