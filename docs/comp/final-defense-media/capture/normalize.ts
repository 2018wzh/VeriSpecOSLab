import { existsSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const mediaRoot = resolve(import.meta.dir, "..");
const videoRoot = join(mediaRoot, "videos");
const videos = [
  "p08-kb-citation.mp4",
  "p09-kernel-debug.mp4",
  "p10-qemu-port.mp4",
  "p11-commit-replay.mp4",
];

for (const name of videos) {
  const input = join(videoRoot, name);
  if (!existsSync(input)) throw new Error(`missing VHS output: ${name}`);
  const output = join(videoRoot, `.${name}.normalized.mp4`);
  rmSync(output, { force: true });
  const result = Bun.spawnSync([
    "ffmpeg", "-y", "-i", input,
    "-vf", "fps=30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    output,
  ], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    rmSync(output, { force: true });
    throw new Error(`ffmpeg normalization failed for ${name}:\n${result.stderr.toString()}`);
  }
  rmSync(input);
  renameSync(output, input);
}

console.log(`normalized ${videos.length} videos to H.264 1600x900 at 30 fps`);
