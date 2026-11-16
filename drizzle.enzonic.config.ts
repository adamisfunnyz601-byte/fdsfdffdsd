import { defineConfig } from "drizzle-kit";

if (!process.env.ENZONIC_DATABASE_URL) throw new Error("ENZONIC_DATABASE_URL must point to Enzonic.");

export default defineConfig({
  out: "./migrations/enzonic",
  schema: "./shared/account-schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.ENZONIC_DATABASE_URL },
});
