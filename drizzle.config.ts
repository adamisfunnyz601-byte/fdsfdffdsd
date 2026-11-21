import { defineConfig } from "drizzle-kit";

// Drizzle Kit needs a direct, unpooled PostgreSQL connection for schema
// introspection and DDL. Keep MESSAGES_URL as the runtime pooled URL.
const rawChatDatabaseUrl =
  process.env.MESSAGES_URL_UNPOOLED || process.env.MESSAGES_URL;
if (!rawChatDatabaseUrl) {
  throw new Error(
    "MESSAGES_URL_UNPOOLED (or MESSAGES_URL) must point to the chat PostgreSQL database.",
  );
}

export default defineConfig({
  out: "./migrations/chat",
  schema: "./shared/chat-schema.ts",
  dialect: "postgresql",
  // Enzonic installs pg_stat_statements; never let Drizzle manage its extension-owned views.
  tablesFilter: ["!pg_stat_*", "!nexus_storage_cleanup_state"],
  dbCredentials: { url: rawChatDatabaseUrl },
});
