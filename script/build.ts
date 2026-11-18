import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFile, cp, mkdir, rm, readFile, access } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // connect-pg-simple loads this SQL file relative to the bundled server entry.
  // Keep it beside dist/index.cjs so automatic session-table creation works.
  await mkdir("dist", { recursive: true });
  await copyFile("node_modules/connect-pg-simple/table.sql", "dist/table.sql");

  // Serverless deployments commonly package only dist/. The media installer
  // runs before this build and places native tools in vendor/bin, so explicitly
  // include those binaries in the runtime bundle after dist has been recreated.
  await access("vendor/bin/yt-dlp");
  await access("vendor/bin/ffmpeg");
  await access("vendor/bin/ffprobe");
  // Dereference symlinks while copying. Some serverless packagers omit or
  // rewrite symlinks, which can leave bundled interpreters pointing at files
  // that are no longer present in the deployed artifact.
  await cp("vendor/bin", "dist/vendor/bin", { recursive: true, force: true, dereference: true });

  // Validate the exact interpreter path that the deployed yt-dlp launcher uses.
  if (process.platform === "linux") {
    const pythonPath = "dist/vendor/bin/python-runtime/bin/python3";
    await access(pythonPath);
    const pythonCheck = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync(pythonPath, ["--version"], { encoding: "utf8", timeout: 15_000 }),
    );
    if (pythonCheck.status !== 0) {
      throw new Error(`Bundled runtime Python is not executable from dist/: ${pythonCheck.stderr || pythonCheck.error || "unknown error"}`);
    }
    console.log("[media-tools] Bundled runtime Python: " + String(pythonCheck.stdout || pythonCheck.stderr).trim());
  }
  console.log("Media tools copied to dist/vendor/bin");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
