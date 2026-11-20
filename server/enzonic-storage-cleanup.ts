import pg from "pg";

const { Pool } = pg;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_LOCK_ID = 731928402;
const DEFAULT_LIMIT_MB = 3072;
const DEFAULT_TRIGGER_MB = 2700;
const DEFAULT_BATCH_MB = 1536;

function mbBytes(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.floor(mb * 1024 * 1024);
}

const accountsDatabaseUrl = process.env.ACCOUNTS_URL || process.env.ENZONIC_DATABASE_URL;
const enzonicPool = accountsDatabaseUrl
  ? new Pool({
      connectionString: accountsDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    })
  : null;

enzonicPool?.on("error", (error) => {
  console.error("[enzonic-cleanup] Unexpected idle-client error:", error);
});

async function runEnzonicCleanup(): Promise<void> {
  if (!enzonicPool) return;
  const client = await enzonicPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [CLEANUP_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS nexus_enzonic_cleanup_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        over_threshold BOOLEAN NOT NULL DEFAULT FALSE,
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_cleanup_at TIMESTAMPTZ,
        last_cleanup_db_bytes BIGINT
      )
    `);
    await client.query("INSERT INTO nexus_enzonic_cleanup_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

    const size = await client.query<{ size_bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS size_bytes",
    );
    const usedBytes = Number(size.rows[0]?.size_bytes || 0);
    const limitBytes = mbBytes(process.env.ENZONIC_DATABASE_STORAGE_LIMIT_MB, DEFAULT_LIMIT_MB);
    const triggerBytes = mbBytes(process.env.ENZONIC_CLEANUP_TRIGGER_MB, DEFAULT_TRIGGER_MB);
    const batchBytes = mbBytes(process.env.ENZONIC_CLEANUP_BATCH_MB, DEFAULT_BATCH_MB);
    if (triggerBytes >= limitBytes) throw new Error("Enzonic cleanup trigger must be below its database storage limit.");

    const state = await client.query<{ over_threshold: boolean }>(
      "SELECT over_threshold FROM nexus_enzonic_cleanup_state WHERE id = 1 FOR UPDATE",
    );
    if (usedBytes < triggerBytes) {
      await client.query("UPDATE nexus_enzonic_cleanup_state SET over_threshold = FALSE, last_checked_at = NOW() WHERE id = 1");
      await client.query("COMMIT");
      return;
    }
    if (state.rows[0]?.over_threshold) {
      await client.query("UPDATE nexus_enzonic_cleanup_state SET last_checked_at = NOW() WHERE id = 1");
      await client.query("COMMIT");
      return;
    }

    // Only chat message tables are eligible. Never delete users, accounts,
    // avatars, profile data, credentials, access keys, or sessions.
    const columns = await client.query<{ table_name: string; has_created_at: boolean; has_content: boolean; has_media_url: boolean }>(`
      SELECT table_name,
        bool_or(column_name = 'created_at') AS has_created_at,
        bool_or(column_name = 'content') AS has_content,
        bool_or(column_name = 'media_url') AS has_media_url
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('messages', 'community_server_messages')
      GROUP BY table_name
    `);
    const available = new Map(columns.rows.map(row => [row.table_name, row]));
    const eligibleMessages = available.get("messages");
    const eligibleCommunity = available.get("community_server_messages");
    const sources: string[] = [];

    if (eligibleMessages?.has_created_at && eligibleMessages.has_content) {
      sources.push(`SELECT 'messages'::text AS table_name, id, created_at,
        (COALESCE(octet_length(content), 0) + ${eligibleMessages.has_media_url ? "COALESCE(octet_length(media_url), 0) +" : ""} 128)::bigint AS payload_bytes
        FROM public.messages`);
    }
    if (eligibleCommunity?.has_created_at && eligibleCommunity.has_content) {
      sources.push(`SELECT 'community_server_messages'::text AS table_name, id, created_at,
        (COALESCE(octet_length(content), 0) + 128)::bigint AS payload_bytes
        FROM public.community_server_messages`);
    }

    if (!sources.length) {
      await client.query("UPDATE nexus_enzonic_cleanup_state SET last_checked_at = NOW() WHERE id = 1");
      await client.query("COMMIT");
      console.log("[enzonic-cleanup] No eligible chat tables exist in Enzonic; no data was deleted.");
      return;
    }

    const deleteSql = `
      WITH candidates AS (${sources.join("\nUNION ALL\n")}),
      ranked AS (
        SELECT table_name, id, payload_bytes,
          COALESCE(SUM(payload_bytes) OVER (
            ORDER BY created_at ASC NULLS FIRST, table_name, id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS bytes_before
        FROM candidates
      ),
      doomed AS (SELECT table_name, id FROM ranked WHERE bytes_before < $1),
      deleted_messages AS (
        ${eligibleMessages?.has_created_at && eligibleMessages.has_content
          ? "DELETE FROM public.messages m USING doomed d WHERE d.table_name = 'messages' AND m.id = d.id RETURNING 'messages'::text AS table_name, m.id"
          : "SELECT NULL::text AS table_name, NULL::integer AS id WHERE FALSE"}
      ),
      deleted_community AS (
        ${eligibleCommunity?.has_created_at && eligibleCommunity.has_content
          ? "DELETE FROM public.community_server_messages c USING doomed d WHERE d.table_name = 'community_server_messages' AND c.id = d.id RETURNING 'community_server_messages'::text AS table_name, c.id"
          : "SELECT NULL::text AS table_name, NULL::integer AS id WHERE FALSE"}
      )
      SELECT table_name, id FROM deleted_messages
      UNION ALL SELECT table_name, id FROM deleted_community
    `;
    const deleted = await client.query<{ table_name: string; id: number }>(deleteSql, [batchBytes]);
    await client.query(`
      UPDATE nexus_enzonic_cleanup_state
      SET over_threshold = TRUE, last_checked_at = NOW(), last_cleanup_at = NOW(),
          last_cleanup_db_bytes = $1
      WHERE id = 1
    `, [usedBytes]);
    await client.query("COMMIT");

    const direct = deleted.rows.filter(row => row.table_name === "messages").length;
    const community = deleted.rows.filter(row => row.table_name === "community_server_messages").length;
    console.warn(`[enzonic-cleanup] Triggered at 2700 MB; deleted ${direct} direct/group and ${community} community messages, targeting approximately 1536 MB of message payload. Account and profile tables were untouched.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[enzonic-cleanup] Cleanup check failed:", error);
  } finally {
    client.release();
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startEnzonicStorageCleanup(): void {
  if (!enzonicPool) {
    console.warn("[enzonic-cleanup] ACCOUNTS_URL (or ENZONIC_DATABASE_URL) is not configured; cleanup is disabled.");
    return;
  }
  if (cleanupTimer) return;
  void runEnzonicCleanup().catch((error) => {
    console.error("[enzonic-cleanup] Initial cleanup failed:", error);
  });
  cleanupTimer = setInterval(() => {
    void runEnzonicCleanup().catch((error) => {
      console.error("[enzonic-cleanup] Scheduled cleanup failed:", error);
    });
  }, CHECK_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export async function closeEnzonicStorageCleanup(): Promise<void> {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  if (enzonicPool) await enzonicPool.end();
}
