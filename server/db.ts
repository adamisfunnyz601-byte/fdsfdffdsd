
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(poolMax) && poolMax > 0 ? Math.min(poolMax, 20) : 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  maxLifetimeSeconds: 1_800,
});

pool.on("error", (error) => {
  console.error("[database] Unexpected idle-client error:", error);
});

export const db = drizzle(pool, { schema });
