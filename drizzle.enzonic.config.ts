import { defineConfig } from "drizzle-kit";

const accountsDatabaseUrl = process.env.ACCOUNTS_URL || process.env.ENZONIC_DATABASE_URL;
if (!accountsDatabaseUrl) throw new Error("ACCOUNTS_URL (or ENZONIC_DATABASE_URL) must point to Enzonic.");


export default defineConfig({
  out: "./migrations/enzonic",
  schema: "./shared/account-schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: accountsDatabaseUrl },
});
