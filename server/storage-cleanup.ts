import { chatPool } from "./db";

const TRIGGER_MB = 1600;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_LOCK_ID = 731928401;

async function runStorageCleanup(): Promise<void> {
  const client = await chatPool.connect();
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
    await client.query("INSERT INTO nexus_storage_cleanup_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    const size = await client.query<{ size_bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS size_bytes",
    );
    const usedBytes = Number(size.rows[0]?.size_bytes || 0);
    const triggerBytes = TRIGGER_MB * 1024 * 1024;
    const state = await client.query<{ over_threshold: boolean }>(
      "SELECT over_threshold FROM nexus_storage_cleanup_state WHERE id = 1 FOR UPDATE",
    );

    if (usedBytes < triggerBytes) {
      await client.query("UPDATE nexus_storage_cleanup_state SET over_threshold = FALSE, last_checked_at = NOW() WHERE id = 1");
      await client.query("COMMIT");
      return;
    }
    if (state.rows[0]?.over_threshold) {
      await client.query("UPDATE nexus_storage_cleanup_state SET last_checked_at = NOW() WHERE id = 1");
      await client.query("COMMIT");
      return;
    }

    // Remove the oldest half of each chat history. Foreign-key cascades remove
    // reactions, poll options/votes and other message-owned records.
    const direct = await client.query(`
      WITH doomed AS (
        SELECT id FROM messages ORDER BY created_at ASC NULLS FIRST, id
        LIMIT (SELECT CEIL(COUNT(*) / 2.0)::int FROM messages)
      )
      DELETE FROM messages m USING doomed d WHERE m.id = d.id
      RETURNING m.id
    `);
    const community = await client.query(`
      WITH doomed AS (
        SELECT id FROM community_server_messages ORDER BY created_at ASC NULLS FIRST, id
        LIMIT (SELECT CEIL(COUNT(*) / 2.0)::int FROM community_server_messages)
      )
      DELETE FROM community_server_messages m USING doomed d WHERE m.id = d.id
      RETURNING m.id
    `);

    // GIF blobs are stored separately; remove their oldest half when the table
    // exists. The GIF table is created by the chat API at runtime.
    await client.query(`
      DO $cleanup$
      DECLARE gif_table regclass := to_regclass('public.nexus_chat_gif_attachments');
      BEGIN
        IF gif_table IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='nexus_chat_gif_attachments'
                         AND column_name='created_at') THEN
          EXECUTE 'DELETE FROM public.nexus_chat_gif_attachments
                   WHERE filename IN (
                     SELECT filename FROM public.nexus_chat_gif_attachments
                     ORDER BY created_at ASC NULLS FIRST, filename
                     LIMIT (SELECT CEIL(COUNT(*) / 2.0)::int FROM public.nexus_chat_gif_attachments)
                   )';
        END IF;
      END
      $cleanup$;
    `);

    await client.query(`
      UPDATE nexus_storage_cleanup_state
      SET over_threshold = TRUE, last_checked_at = NOW(),
          last_cleanup_at = NOW(), last_cleanup_db_bytes = $1
      WHERE id = 1
    `, [usedBytes]);
    await client.query("COMMIT");
    console.warn(`[prisma-cleanup] Prisma Postgres reached 1.6 GB; deleted ${direct.rowCount ?? 0} oldest direct/group messages and ${community.rowCount ?? 0} oldest community messages, plus half of stored GIFs where timestamped. Enzonic account data was not touched.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[prisma-cleanup] Cleanup failed:", error);
  } finally {
    client.release();
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startStorageCleanup(): void {
  if (cleanupTimer) return;
  void runStorageCleanup();
  cleanupTimer = setInterval(() => { void runStorageCleanup(); }, CHECK_INTERVAL_MS);
  cleanupTimer.unref?.();
}
