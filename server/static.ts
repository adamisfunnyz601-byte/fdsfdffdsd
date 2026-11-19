import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      const normalized = filePath.split(path.sep).join("/");
      // Vite fingerprints production bundles, so they can be cached indefinitely.
      if (normalized.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (normalized.includes("/icons/") || /nexus-icon\\.png$|favicon\\.png$/.test(normalized)) {
        // User-managed icons can change between deploys; keep a short cache.
        res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
      } else if (normalized.endsWith("/index.html")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      }
    },
  }));

  // Fall through to index.html if the file doesn't exist.
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
