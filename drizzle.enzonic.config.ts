import { defineConfig } from "drizzle-kit";

if (!process.env.ENZONIC_DATABASE_URL) throw new Error("ENZONIC_DATABASE_URL must point to Enzonic.");

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

export default defineConfig({
  out: "./migrations/enzonic",
  schema: "./shared/account-schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: withEnzonicEndpoint(process.env.ENZONIC_DATABASE_URL) },
});
