import { spawnSync } from "node:child_process";
import { mkdir, copyFile, chmod, access, stat } from "node:fs/promises";
import { resolve } from "node:path";

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
for (const file of [resolve(binDir, ffmpegName), resolve(binDir, ffprobeName)]) {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`Invalid media binary: ${file}`);
}

console.log("[media-tools] Downloading yt-dlp standalone release...");
// Use yt-dlp's musllinux standalone build on Linux. It avoids relying on
// the host's glibc/zlib shared-library mapping, which can fail in serverless
// runtimes such as the one used by this deployment.
const ytName = process.platform === "win32" ? "yt-dlp.exe"
  : process.platform === "darwin" ? "yt-dlp_macos"
  : process.platform === "linux" && process.arch === "arm64" ? "yt-dlp_musllinux_aarch64"
  : process.platform === "linux" && process.arch === "x64" ? "yt-dlp_musllinux"
  : null;
if (!ytName) throw new Error(`No supported yt-dlp binary for ${process.platform}/${process.arch}.`);
const ytUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytName}`;
const response = await fetch(ytUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
const ytPath = resolve(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 1_000_000) throw new Error("Downloaded yt-dlp file is unexpectedly small.");
await (await import("node:fs/promises")).writeFile(ytPath, bytes);
if (process.platform !== "win32") await chmod(ytPath, 0o755);
const ytInfo = await stat(ytPath);
if (!ytInfo.isFile() || ytInfo.size < 1_000_000) throw new Error("Downloaded yt-dlp executable failed validation.");
await access(ytPath, process.platform === "win32" ? undefined : (await import("node:fs")).constants.X_OK);

console.log("[media-tools] Installed binaries:");
console.log("YTDLP_PATH=" + ytPath);
console.log("FFMPEG_LOCATION=" + binDir);
console.log("FFPROBE_PATH=" + resolve(binDir, ffprobeName));
