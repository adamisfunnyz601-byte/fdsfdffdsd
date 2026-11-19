import { defineConfig } from "drizzle-kit";

const chatDatabaseUrl = process.env.CHAT_DATABASE_URL || process.env.DATABASE_URL;
if (!chatDatabaseUrl) throw new Error("CHAT_DATABASE_URL (or legacy DATABASE_URL) must point to the chat PostgreSQL database.");

export default defineConfig({
  out: "./migrations/chat",
  schema: "./shared/chat-schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: chatDatabaseUrl },
});
