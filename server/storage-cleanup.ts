import { pool } from "./db";

const DEFAULT_DATABASE_LIMIT_MB = 1024;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_LOCK_ID = 731928401;

function getDatabaseLimitBytes(): number {
  const configured = Number(process.env.DATABASE_STORAGE_LIMIT_MB || DEFAULT_DATABASE_LIMIT_MB);
  const limitMb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DATABASE_LIMIT_MB;
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
    const thresholdBytes = Math.floor(getDatabaseLimitBytes() * 0.5);
    const stateResult = await client.query<{ over_threshold: boolean }>(
      "SELECT over_threshold FROM nexus_storage_cleanup_state WHERE id = 1 FOR UPDATE",
    );
    const alreadyHandled = Boolean(stateResult.rows[0]?.over_threshold);

    if (sizeBytes < thresholdBytes) {
      await client.query(
        "UPDATE nexus_storage_cleanup_state SET over_threshold = FALSE, last_checked_at = NOW() WHERE id = 1",
      );
      await client.query("COMMIT");
      return;
    }

    // Only clean once per threshold crossing. DELETE does not immediately shrink
    // PostgreSQL's on-disk files, so repeating while still above 50% could erase
    // the entire chat history. The latch rearms after storage drops below 50%.
    if (alreadyHandled) {
      await client.query(
        "UPDATE nexus_storage_cleanup_state SET last_checked_at = NOW() WHERE id = 1",
      );
      await client.query("COMMIT");
      return;
    }

    const regularMessages = await client.query<{ id: number }>(`
      WITH oldest AS (
        SELECT id
        FROM messages
        ORDER BY created_at ASC NULLS FIRST, id ASC
        LIMIT (SELECT (COUNT(*) + 1) / 2 FROM messages)
      )
      DELETE FROM messages AS m
      USING oldest
      WHERE m.id = oldest.id
      RETURNING m.id
    `);

    const communityMessages = await client.query<{ id: number }>(`
      WITH oldest AS (
        SELECT id
        FROM community_server_messages
        ORDER BY created_at ASC NULLS FIRST, id ASC
        LIMIT (SELECT (COUNT(*) + 1) / 2 FROM community_server_messages)
      )
      DELETE FROM community_server_messages AS m
      USING oldest
      WHERE m.id = oldest.id
      RETURNING m.id
    `);

    await client.query(`
      UPDATE nexus_storage_cleanup_state
      SET over_threshold = TRUE,
          last_checked_at = NOW(),
          last_cleanup_at = NOW(),
          last_cleanup_db_bytes = $1
      WHERE id = 1
    `, [sizeBytes]);

    await client.query("COMMIT");
    console.warn(
      `[storage-cleanup] Database crossed 50% of its configured limit. Removed ${regularMessages.rowCount || 0} oldest chat messages and ${communityMessages.rowCount || 0} oldest community messages (including message-attached media).`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[storage-cleanup] Cleanup check failed:", error);
  } finally {
    client.release();
  }
}

export function startStorageCleanup(): void {
  // Run once after startup, then periodically. The database advisory lock makes
  // this safe when Enzonic has more than one application instance.
  void runStorageCleanup();
  const timer = setInterval(() => void runStorageCleanup(), CHECK_INTERVAL_MS);
  timer.unref?.();
}
