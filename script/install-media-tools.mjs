import { spawnSync } from "node:child_process";
import { mkdir, copyFile, chmod, access, stat, writeFile } from "node:fs/promises";
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

console.log("[media-tools] Installing yt-dlp with a bundled Python runtime...");
const ytPath = resolve(binDir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
if (process.platform === "linux") {
  // Enzonic's Node runtime does not include Python. Bundle a relocatable CPython
  // distribution so conversions do not depend on tools installed in the host image.
  const platformByArch = {
    x64: { target: "x86_64-unknown-linux-gnu", sha256: "3288c54cea3db350052019b3f8b558dd8a3da8afa6fda573f5fd2bcb37635b4a" },
    arm64: { target: "aarch64-unknown-linux-gnu", sha256: "7e71f26a003949b57757e287f4f4b6689da07e7a229f5bbee7919c19ed77155d" },
  };
  const platform = platformByArch[process.arch];
  if (!platform) throw new Error(`Bundled Python is not available for Linux architecture ${process.arch}.`);

  const pythonVersion = "3.11.18+20261110";
  const archiveName = `cpython-${pythonVersion}-${platform.target}-install_only_stripped.tar.gz`;
  const archiveUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/20261110/${archiveName.replace("+", "%2B")}`;
  const archiveResponse = await fetch(archiveUrl, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!archiveResponse.ok) throw new Error(`Bundled Python download failed: HTTP ${archiveResponse.status}`);
  const archiveBytes = Buffer.from(await archiveResponse.arrayBuffer());
  const actualHash = (await import("node:crypto")).createHash("sha256").update(archiveBytes).digest("hex");
  if (actualHash !== platform.sha256) throw new Error("Bundled Python archive failed SHA-256 verification.");

  const archivePath = resolve(binDir, "python-runtime.tar.gz");
  const pythonRuntimeDir = resolve(binDir, "python-runtime");
  await writeFile(archivePath, archiveBytes);
  await mkdir(pythonRuntimeDir, { recursive: true });
  const extract = spawnSync("tar", ["-xzf", archivePath, "-C", pythonRuntimeDir, "--strip-components=1"], {
    cwd: root, encoding: "utf8", timeout: 120_000,
  });
  const { unlink } = await import("node:fs/promises");
  await unlink(archivePath).catch(() => undefined);
  if (extract.status !== 0) throw new Error(`Could not extract bundled Python: ${extract.stderr || extract.error || "tar failed"}`);

  const pythonPath = resolve(pythonRuntimeDir, "bin", "python3");
  const pythonCheck = spawnSync(pythonPath, ["--version"], { encoding: "utf8", timeout: 15_000 });
  if (pythonCheck.status !== 0) throw new Error(`Bundled Python failed its version check: ${pythonCheck.stderr || pythonCheck.error || "unknown error"}`);
  const pip = spawnSync(pythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--no-compile", "--target", resolve(binDir, "yt-dlp-python"), "yt-dlp"], {
    cwd: root, encoding: "utf8", timeout: 180_000,
  });
  if (pip.status !== 0) throw new Error(`Could not install yt-dlp into bundled Python: ${pip.stderr || pip.stdout || pip.error || "pip failed"}`);

  await writeFile(ytPath, `#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PYTHONPATH="$SCRIPT_DIR/yt-dlp-python${"${PYTHONPATH:+:$PYTHONPATH}"}" exec "$SCRIPT_DIR/python-runtime/bin/python3" -m yt_dlp "$@"
`, { mode: 0o755 });
  await chmod(ytPath, 0o755);
} else {
  const ytName = process.platform === "win32" ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : null;
  if (!ytName) throw new Error(`No supported yt-dlp binary for ${process.platform}/${process.arch}.`);
  const ytUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytName}`;
  const response = await fetch(ytUrl, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) throw new Error("Downloaded yt-dlp file is unexpectedly small.");
  await writeFile(ytPath, bytes);
  if (process.platform !== "win32") await chmod(ytPath, 0o755);
  const ytInfo = await stat(ytPath);
  if (!ytInfo.isFile() || ytInfo.size < 1_000_000) throw new Error("Downloaded yt-dlp file failed validation.");
}
const ytCheck = spawnSync(ytPath, ["--version"], { encoding: "utf8", timeout: 30_000 });
if (ytCheck.status !== 0 || !/^\d{4}\.\d{2}\.\d{2}/.test(String(ytCheck.stdout || "").trim())) {
  throw new Error(`yt-dlp executable failed its version check: ${ytCheck.stderr || ytCheck.error || "unknown error"}`);
}

console.log("[media-tools] Installed binaries:");
console.log("YTDLP_PATH=" + ytPath);
console.log("FFMPEG_LOCATION=" + binDir);
console.log("FFPROBE_PATH=" + resolve(binDir, ffprobeName));
