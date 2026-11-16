import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to Prisma Postgres.");

export default defineConfig({
  out: "./migrations/prisma",
  schema: "./shared/chat-schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
});
