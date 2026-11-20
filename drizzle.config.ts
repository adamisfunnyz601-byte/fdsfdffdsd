import { defineConfig } from "drizzle-kit";

const rawChatDatabaseUrl = process.env.MESSAGES_URL || process.env.DATABASE_URL;
if (!rawChatDatabaseUrl) throw new Error("MESSAGES_URL (or DATABASE_URL) must point to the chat PostgreSQL database.");

const chatDatabaseUrl = rawChatDatabaseUrl;

export default defineConfig({
  out: "./migrations/chat",
  schema: "./shared/chat-schema.ts",
  dialect: "postgresql",
  // Enzonic installs pg_stat_statements; never let Drizzle manage its extension-owned views.
  tablesFilter: ["!pg_stat_*", "!nexus_storage_cleanup_state"],
  dbCredentials: { url: chatDatabaseUrl },
});
