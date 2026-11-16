import { pool } from "./db";

const DEFAULT_DATABASE_LIMIT_MB = 1024;
const DEFAULT_CLEANUP_TRIGGER_MB = 875;
const DEFAULT_CLEANUP_BATCH_MB = 512;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_LOCK_ID = 731928401;

function getPositiveMb(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCleanupTriggerBytes(): number {
  const triggerMb = getPositiveMb(
    process.env.DATABASE_CLEANUP_TRIGGER_MB,
    DEFAULT_CLEANUP_TRIGGER_MB,
  );
  return Math.floor(triggerMb * 1024 * 1024);
}

function getCleanupBatchBytes(): number {
  const batchMb = getPositiveMb(
    process.env.DATABASE_CLEANUP_BATCH_MB,
    DEFAULT_CLEANUP_BATCH_MB,
  );
  return Math.floor(batchMb * 1024 * 1024);
}

function getDatabaseLimitBytes(): number {
  const limitMb = getPositiveMb(
    process.env.DATABASE_STORAGE_LIMIT_MB,
    DEFAULT_DATABASE_LIMIT_MB,
  );
  return Math.floor(limitMb * 1024 * 1024);
}

async function runStorageCleanup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [CLEANUP_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS nexus_storage_cleanup_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        over_threshold BOOLEAN NOT NULL DEFAULT FALSE,
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_cleanup_at TIMESTAMPTZ,
        last_cleanup_db_bytes BIGINT
      )
    `);
    await client.query(`
      INSERT INTO nexus_storage_cleanup_state (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);

    const sizeResult = await client.query<{ size_bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS size_bytes",
    );
    const sizeBytes = Number(sizeResult.rows[0]?.size_bytes || 0);
    const triggerBytes = getCleanupTriggerBytes();
    const configuredLimitBytes = getDatabaseLimitBytes();
    const batchBytes = getCleanupBatchBytes();

    if (triggerBytes >= configuredLimitBytes) {
      throw new Error("DATABASE_CLEANUP_TRIGGER_MB must be lower than DATABASE_STORAGE_LIMIT_MB.");
    }

    const stateResult = await client.query<{ over_threshold: boolean }>(
      "SELECT over_threshold FROM nexus_storage_cleanup_state WHERE id = 1 FOR UPDATE",
    );
    const alreadyHandled = Boolean(stateResult.rows[0]?.over_threshold);

    if (sizeBytes < triggerBytes) {
      await client.query(
        "UPDATE nexus_storage_cleanup_state SET over_threshold = FALSE, last_checked_at = NOW() WHERE id = 1",
      );
      await client.query("COMMIT");
      return;
    }

    // PostgreSQL does not immediately shrink its data files after DELETE. Run one
    // bounded batch per threshold crossing so repeated checks cannot erase history.
    if (alreadyHandled) {
      await client.query(
        "UPDATE nexus_storage_cleanup_state SET last_checked_at = NOW() WHERE id = 1",
      );
      await client.query("COMMIT");
      return;
    }

    // Select the oldest chat rows across both chat tables until their estimated
    // content + attachment payload reaches the configured batch size. Account
    // tables (including users, avatars and credentials) are never touched.
    const deleted = await client.query<{ table_name: string; id: number }>(`
      WITH candidates AS (
        SELECT
          'messages'::text AS table_name,
          id,
          created_at,
          (COALESCE(octet_length(content), 0)
            + COALESCE(octet_length(media_url), 0) + 128)::bigint AS payload_bytes
        FROM messages
        UNION ALL
        SELECT
          'community_server_messages'::text AS table_name,
          id,
          created_at,
          (COALESCE(octet_length(content), 0) + 128)::bigint AS payload_bytes
        FROM community_server_messages
      ),
      ranked AS (
        SELECT
          table_name,
          id,
          payload_bytes,
          COALESCE(
            SUM(payload_bytes) OVER (
              ORDER BY created_at ASC NULLS FIRST, table_name, id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          ) AS bytes_before
        FROM candidates
      ),
      doomed AS (
        SELECT table_name, id
        FROM ranked
        WHERE bytes_before < $1
      ),
      deleted_messages AS (
        DELETE FROM messages m
        USING doomed d
        WHERE d.table_name = 'messages' AND m.id = d.id
        RETURNING 'messages'::text AS table_name, m.id
      ),
      deleted_community AS (
        DELETE FROM community_server_messages c
        USING doomed d
        WHERE d.table_name = 'community_server_messages' AND c.id = d.id
        RETURNING 'community_server_messages'::text AS table_name, c.id
      )
      SELECT table_name, id FROM deleted_messages
      UNION ALL
      SELECT table_name, id FROM deleted_community
    `, [batchBytes]);

    await client.query(`
      UPDATE nexus_storage_cleanup_state
      SET over_threshold = TRUE,
          last_checked_at = NOW(),
          last_cleanup_at = NOW(),
          last_cleanup_db_bytes = $1
      WHERE id = 1
    `, [sizeBytes]);

    await client.query("COMMIT");
    const regularCount = deleted.rows.filter(row => row.table_name === "messages").length;
    const communityCount = deleted.rows.filter(row => row.table_name === "community_server_messages").length;
    console.warn(
      `[storage-cleanup] Database reached the ${Math.round(triggerBytes / 1024 / 1024)} MB cleanup trigger. Removed ${regularCount} oldest direct/group messages and ${communityCount} oldest community messages (approximately ${Math.round(batchBytes / 1024 / 1024)} MB of message payload targeted). Accounts and profile data were untouched.`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[storage-cleanup] Cleanup check failed:", error);
  } finally {
    client.release();
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startStorageCleanup(): void {
  // This service's DATABASE_URL is Neon (chat storage). Enzonic is reserved for
  // account data and is not cleaned by this job.
  if (cleanupTimer) return;
  void runStorageCleanup().catch((error) => {
    console.error("[storage-cleanup] Initial cleanup failed:", error);
  });
  cleanupTimer = setInterval(() => {
    void runStorageCleanup().catch((error) => {
      console.error("[storage-cleanup] Scheduled cleanup failed:", error);
    });
  }, CHECK_INTERVAL_MS);
  cleanupTimer.unref?.();
}
