import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { startStorageCleanup } from "./storage-cleanup";
import { serveStatic } from "./static";
import { createServer } from "http";
import { chatPool, enzonicPool } from "./db";

const app = express();
const httpServer = createServer(app);
app.set("trust proxy", 1);

// Native Capacitor shells use a local origin while the API remains hosted.
// Allow only the app's known origins and keep session cookies enabled.
const allowedAppOrigins = new Set([
  "capacitor://localhost",
  "null",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  "https://nexus.is-a.bot",
  "https://nexus.tunnelto.me",
  process.env.APP_ORIGIN || "",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedAppOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Response bodies may contain large image data URLs or private profile data.
      // Keep request logs small and avoid serializing the full payload on the event loop.
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  startStorageCleanup();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Liveness: confirms the Node process is running without depending on the database.
  app.get(["/health", "/healthz"], (_req, res) => {
    res.status(200).json({ status: "ok", service: "nexus-api" });
  });

  // Readiness: only route traffic here when the primary database can answer.
  app.get("/readyz", async (_req, res) => {
    try {
      await Promise.all([
        chatPool.query("SELECT 1"),
        enzonicPool.query("SELECT 1"),
      ]);
      res.status(200).json({ status: "ready", service: "nexus-api", databases: { prisma: "ok", enzonic: "ok" } });
    } catch (error) {
      console.error("[health] Readiness check failed:", error);
      res.status(503).json({ status: "not_ready", service: "nexus-api" });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS prefer the hosting platform PORT. Other ports may be firewalled.
  // Default to 3000 for Enzonic deployments.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || process.env.SERVER_PORT || "3000", 10);
  // Windows does not support Node's reusePort option on all socket providers.
  // A normal bind is sufficient for this single-instance self-hosted server.
  let isShuttingDown = false;
  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`Received ${signal}; shutting down gracefully.`);
    httpServer.close(async () => {
      await Promise.all([chatPool.end(), enzonicPool.end()]);
      process.exit(0);
    });
    // Do not leave a stuck process running forever during platform shutdown.
    const forceExit = setTimeout(() => process.exit(1), 15_000);
    forceExit.unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
