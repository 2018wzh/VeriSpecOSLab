import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const mediaRoot = resolve(import.meta.dir, "..");
const videoRoot = join(mediaRoot, "videos");
const frameRoot = join(mediaRoot, "frames");
mkdirSync(frameRoot, { recursive: true });

const expected = [
  ["p08-kb-citation.mp4", 10, 17],
  ["p09-kernel-debug.mp4", 15, 22],
  ["p10-qemu-port.mp4", 15, 22],
  ["p11-commit-replay.mp4", 10, 17],
] as const;

const manifest: Array<Record<string, unknown>> = [];
for (const [name, minDuration, maxDuration] of expected) {
  const path = join(videoRoot, name);
  if (!existsSync(path)) throw new Error(`missing video: ${name}`);
  const probe = Bun.spawnSync([
    "ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height,r_frame_rate",
    "-of", "json", path,
  ], { stdout: "pipe", stderr: "pipe" });
  if (probe.exitCode !== 0) throw new Error(probe.stderr.toString());
  const info = JSON.parse(probe.stdout.toString());
  const duration = Number(info.format.duration);
  const video = info.streams.find((stream: any) => stream.width && stream.height);
  if (!video || video.codec_name !== "h264" || video.width !== 1600 || video.height !== 900 || video.r_frame_rate !== "30/1") {
    throw new Error(`${name} has unexpected video format: ${JSON.stringify(video)}`);
  }
  if (duration < minDuration || duration > maxDuration) {
    throw new Error(`${name} duration ${duration}s is outside ${minDuration}-${maxDuration}s`);
  }
  const framePath = join(frameRoot, name.replace(/\.mp4$/, ".png"));
  const frame = Bun.spawnSync([
    "ffmpeg", "-y", "-sseof", "-0.25", "-i", path, "-frames:v", "1", framePath,
  ], { stdout: "pipe", stderr: "pipe" });
  if (frame.exitCode !== 0) throw new Error(frame.stderr.toString());
  manifest.push({
    file: `videos/${name}`,
    frame: `frames/${name.replace(/\.mp4$/, ".png")}`,
    duration_seconds: duration,
    codec: video.codec_name,
    width: video.width,
    height: video.height,
    frame_rate: video.r_frame_rate,
    bytes: Number(info.format.size),
  });
}

await Bun.write(join(mediaRoot, "media-manifest.json"), `${JSON.stringify({ version: "final-defense-media.v1", generated_at: new Date().toISOString(), artifacts: manifest }, null, 2)}\n`);
console.log(`validated ${manifest.length} videos and extracted ${manifest.length} key frames`);
