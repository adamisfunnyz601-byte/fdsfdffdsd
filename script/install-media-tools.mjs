import { spawnSync } from "node:child_process";
import { mkdir, copyFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const binDir = resolve(root, "vendor/bin");
await mkdir(binDir, { recursive: true });

console.log("[media-tools] Installing pinned FFmpeg and FFprobe packages...");
const install = spawnSync("npm", [
  "install", "--no-save", "--package-lock=false",
  "ffmpeg-static@5.2.0", "ffprobe-static@3.1.0",
], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (install.status !== 0) throw new Error("Could not install FFmpeg/FFprobe packages.");

const ffmpegPackage = await import("ffmpeg-static");
const ffprobePackage = await import("ffprobe-static");
const ffmpegSource = ffmpegPackage.default;
const ffprobeSource = ffprobePackage.default?.path ?? ffprobePackage.path;
if (!ffmpegSource || !ffprobeSource) throw new Error("FFmpeg or FFprobe package did not expose a binary path.");

const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
await copyFile(ffmpegSource, resolve(binDir, ffmpegName));
await copyFile(ffprobeSource, resolve(binDir, ffprobeName));
if (process.platform !== "win32") {
  await chmod(resolve(binDir, ffmpegName), 0o755);
  await chmod(resolve(binDir, ffprobeName), 0o755);
}

console.log("[media-tools] Downloading yt-dlp standalone release...");
const ytName = process.platform === "win32" ? "yt-dlp.exe"
  : process.platform === "darwin" ? "yt-dlp_macos"
  : "yt-dlp_linux";
const ytUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytName}`;
const response = await fetch(ytUrl, { redirect: "follow" });
if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
const ytPath = resolve(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 1_000_000) throw new Error("Downloaded yt-dlp file is unexpectedly small.");
await (await import("node:fs/promises")).writeFile(ytPath, bytes);
if (process.platform !== "win32") await chmod(ytPath, 0o755);

console.log("[media-tools] Installed binaries:");
console.log("YTDLP_PATH=" + ytPath);
console.log("FFMPEG_LOCATION=" + binDir);
console.log("FFPROBE_PATH=" + resolve(binDir, ffprobeName));
