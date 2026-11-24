import pg from "pg";

const connectionString =
  process.env.MESSAGES_URL_UNPOOLED ||
  process.env.MESSAGES_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing MESSAGES_URL_UNPOOLED, MESSAGES_URL, or DATABASE_URL; cannot apply chat schema migration.",
  );
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 15000,
});

const statements = [
  // The chat database is deliberately separate from the accounts database.
  // Do not silently create a partial messages table: existing message history
  // must remain owned by the established schema.
  `ALTER TABLE public.messages
     ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS public.nexus_moments (
     id SERIAL PRIMARY KEY,
     user_id INTEGER NOT NULL,
     content TEXT NOT NULL DEFAULT '',
     media_url TEXT,
     media_type TEXT,
     background TEXT NOT NULL DEFAULT 'violet',
     expires_at TIMESTAMP NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS public.nexus_moment_reactions (
     id SERIAL PRIMARY KEY,
     moment_id INTEGER NOT NULL REFERENCES public.nexus_moments(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL,
     emoji TEXT NOT NULL,
     created_at TIMESTAMP DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS nexus_moment_reaction_unique
     ON public.nexus_moment_reactions(moment_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS nexus_moments_expires_at_idx
     ON public.nexus_moments(expires_at)`,
];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Serialize concurrent app instances so startup migrations cannot race.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('nexus-chat-schema-v2'))");
  for (const statement of statements) await client.query(statement);
  await client.query("COMMIT");
  console.log("[chat-schema] Chat schema migration verified (messages + Moments).");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("[chat-schema] Chat schema migration failed:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

if (process.exitCode) process.exit(process.exitCode);
