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

// Bind the HTTP port before database initialization so a slow or
// temporarily unavailable Postgres service does not cause connection-refused
// health checks during cold starts.
let startupState: "starting" | "ready" | "failed" = "starting";

// Return a retryable response until migrations and API route registration finish.
app.use("/api", (req, res, next) => {
  if (startupState === "ready") return next();
  res.setHeader("Retry-After", "3");
  return res.status(503).json({
    code: "NEXUS_STARTING",
    message: startupState === "failed"
      ? "NEXUS could not finish starting. Check the server database connection."
      : "NEXUS is starting. Please retry shortly.",
  });
});

app.get(["/health", "/healthz"], (_req, res) =>
  res.status(200).json({ status: "ok", service: "nexus-api", startup: startupState }),
);
app.get("/readyz", async (_req, res) => {
  if (startupState !== "ready") {
    return res.status(503).json({ status: startupState, service: "nexus-api" });
  }
  try {
    await Promise.all([chatPool.query("SELECT 1"), enzonicPool.query("SELECT 1")]);
    return res.status(200).json({ status: "ready", service: "nexus-api", databases: { chat: "ok", accounts: "ok" } });
  } catch (error) {
    console.error("[health] Readiness check failed:", error);
    return res.status(503).json({ status: "not_ready", service: "nexus-api" });
  }
});
// Enzonic currently probes "/". Serve a liveness response until the real
// frontend static handler is installed after successful initialization.
app.get("/", (_req, res, next) => {
  if (startupState === "ready") return next();
  if (startupState === "failed") return res.status(503).send("NEXUS startup failed. Check database connectivity and server logs.");
  return res.status(200).send("NEXUS is starting. Database initialization is in progress.");
});
const port = parseInt(process.env.PORT || process.env.SERVER_PORT || "3000", 10);
let isShuttingDown = false;
const shutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`Received ${signal}; shutting down gracefully.`);
  httpServer.close(async () => {
    await Promise.all([chatPool.end(), enzonicPool.end()]);
    process.exit(0);
  });
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
httpServer.listen({ port, host: "0.0.0.0" }, () => {
  log(`serving on port ${port} (database initialization pending)`);
});

// Managed databases can take time to wake and may reset early connections.
// Check both independently so one unavailable database never hides the state
// of the other. Enzonic recommends pooled URLs for application connections.
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describeDatabaseError(error: unknown): string {
  const details = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; syscall?: unknown; address?: unknown; port?: unknown }
    : {};
  const message = error instanceof Error
    ? error.message
    : typeof details.message === "string" ? details.message : String(error);
  // Connection errors should be useful without ever printing credentials.
  let safeMessage = message;
  for (const prefix of ["postgres://", "postgresql://"]) {
    let start = safeMessage.indexOf(prefix);
    while (start !== -1) {
      const credentialsStart = start + prefix.length;
      const at = safeMessage.indexOf("@", credentialsStart);
      if (at === -1) break;
      safeMessage = safeMessage.slice(0, credentialsStart) + "[redacted]" + safeMessage.slice(at);
      start = safeMessage.indexOf(prefix, credentialsStart + "[redacted]".length);
    }
  }
  const code = typeof details.code === "string" ? ` ${details.code}` : "";
  const endpoint = typeof details.address === "string"
    ? ` (${details.address}${typeof details.port === "number" ? `:${details.port}` : ""})`
    : "";
  const syscall = typeof details.syscall === "string" ? ` ${details.syscall}` : "";
  return `${code}${syscall}${endpoint}: ${safeMessage}`;
}

async function waitForDatabaseConnections() {
  let retryDelay = 2_000;
  while (!isShuttingDown) {
    const checks = await Promise.allSettled([
      enzonicPool.query("SELECT 1"),
      chatPool.query("SELECT 1"),
    ]);
    const [accounts, chat] = checks;
    if (accounts.status === "fulfilled" && chat.status === "fulfilled") {
      log("Accounts and chat PostgreSQL connections are ready.", "startup");
      return;
    }

    if (accounts.status === "rejected") {
      log(`Accounts database connection failed:${describeDatabaseError(accounts.reason)}`, "startup");
    }
    if (chat.status === "rejected") {
      log(`Chat database connection failed:${describeDatabaseError(chat.reason)}`, "startup");
    }
    log(`Retrying database connections in ${Math.round(retryDelay / 1000)}s.`, "startup");
    await wait(retryDelay);
    retryDelay = Math.min(Math.round(retryDelay * 1.5), 15_000);
  }
  throw new Error("Server is shutting down.");
}

(async () => {
  await waitForDatabaseConnections();
  await registerRoutes(httpServer, app);
  startStorageCleanup();

  // Never let the frontend's SPA fallback turn unknown API paths into HTTP 200.
  // This also prevents scanners probing for exposed files such as /api/.env
  // from receiving the application HTML as a successful API response.
  app.use("/api", (req, res) => {
    res.status(404).json({ message: "API endpoint not found." });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
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

  startupState = "ready";
  log("Database initialization and route registration completed.");
})().catch((error) => {
  startupState = "failed";
  console.error("[startup] Database initialization failed:", error);
});
