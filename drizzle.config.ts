import { defineConfig } from "drizzle-kit";

const rawChatDatabaseUrl = process.env.DATABASE_URL;
if (!rawChatDatabaseUrl) throw new Error("DATABASE_URL must point to the chat PostgreSQL database.");

function withEnzonicEndpoint(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname.endsWith(".db.enzonic.com") && !url.searchParams.has("options")) {
    const endpoint = url.hostname
      .replace(/-pooler\.db\.enzonic\.com$/, "")
      .replace(/\.db\.enzonic\.com$/, "");
    url.searchParams.set("options", `endpoint=${endpoint}`);
  }
  return url.toString();
}
const chatDatabaseUrl = withEnzonicEndpoint(rawChatDatabaseUrl);

export default defineConfig({
  out: "./migrations/chat",
  schema: "./shared/chat-schema.ts",
  dialect: "postgresql",
  // Enzonic installs pg_stat_statements; never let Drizzle manage its extension-owned views.
  tablesFilter: ["!pg_stat_*", "!nexus_storage_cleanup_state"],
  dbCredentials: { url: chatDatabaseUrl },
});
