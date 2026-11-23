import pg from "pg";

const connectionString =
  process.env.MESSAGES_URL_UNPOOLED ||
  process.env.MESSAGES_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing MESSAGES_URL_UNPOOLED, MESSAGES_URL, or DATABASE_URL; cannot apply chat schema fix.",
  );
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15000,
});

try {
  // Safe to run on every start. Existing message rows are preserved.
  await pool.query(
    "ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP",
  );
  console.log("[chat-schema] Verified messages.edited_at column.");
} catch (error) {
  console.error("[chat-schema] Failed to ensure messages.edited_at exists:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

if (process.exitCode) process.exit(process.exitCode);
