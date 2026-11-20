import { drizzle } from "drizzle-orm/node-postgres";
import { getTableName } from "drizzle-orm";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// Support the Enzonic project variable names as well as the legacy names.
// MESSAGES_URL is the chat database; ACCOUNTS_URL is the accounts database.
const chatConnectionString = process.env.MESSAGES_URL || process.env.DATABASE_URL;
if (!chatConnectionString) {
  throw new Error("MESSAGES_URL (or DATABASE_URL) must point to the chat PostgreSQL database.");
}
const enzonicConnectionString = process.env.ACCOUNTS_URL || process.env.ENZONIC_DATABASE_URL;
if (!enzonicConnectionString) {
  throw new Error("ACCOUNTS_URL (or ENZONIC_DATABASE_URL) must point to the accounts PostgreSQL database.");
}

// Preserve the database provider's requested TLS mode. Rewriting
// sslmode=require to verify-full can reject managed-provider certificates
// that are valid for the provider but not trusted by this container.
// Use the exact provider-issued connection URL. Do not synthesize libpq options.
const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10);
const commonPoolOptions = {
  max: Number.isFinite(poolMax) && poolMax > 0 ? Math.min(poolMax, 20) : 10,
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  maxLifetimeSeconds: 1_800,
};

export const chatPool = new Pool({ ...commonPoolOptions, connectionString: chatConnectionString });
export const enzonicPool = new Pool({ ...commonPoolOptions, connectionString: enzonicConnectionString, max: 5 });

for (const [name, target] of [["chat", chatPool], ["enzonic", enzonicPool]] as const) {
  target.on("error", (error) => console.error(`[${name}-database] Unexpected idle-client error:`, error));
}

export const chatDb = drizzle(chatPool, { schema });
export const enzonicDb = drizzle(enzonicPool, { schema });

// Account identity/profile/security remains in ACCOUNTS_URL. Chat content and
// community-chat structures use MESSAGES_URL.
const CHAT_TABLES = new Set([
  "group_chats", "group_chat_members", "community_servers",
  "community_server_members", "community_server_categories",
  "community_server_channels", "community_server_messages",
  "messages", "blocks", "nexus_chat_gif_attachments", "nexus_voice_calls", "nexus_voice_signals", "nexus_chat_mention_notifications", "chat_message_reactions", "chat_message_edit_history", "nexus_moments", "nexus_moment_reactions", "chat_polls",
  "chat_poll_options", "chat_poll_votes",
]);

function isChatSql(value: unknown): boolean {
  const sqlText = typeof value === "string" ? value :
    value && typeof value === "object" && "text" in value ? String((value as { text: unknown }).text) :
    value && typeof value === "object" && "sql" in value ? String((value as { sql: unknown }).sql) :
    value && typeof value === "object" ? JSON.stringify(value) : "";
  return /\b(group_chats|group_chat_members|community_servers|community_server_members|community_server_categories|community_server_channels|community_server_messages|messages|blocks|chat_message_reactions|chat_message_edit_history|nexus_moments|nexus_moment_reactions|chat_polls|chat_poll_options|chat_poll_votes|nexus_chat_gif_attachments|nexus_voice_calls|nexus_voice_signals|nexus_chat_mention_notifications)\b/i.test(sqlText);
}

function databaseForTable(table: unknown) {
  try { return CHAT_TABLES.has(getTableName(table as never)) ? chatDb : enzonicDb; }
  catch { return enzonicDb; }
}

function routedBuilder(builder: any, chooseFrom = false): any {
  return new Proxy(builder, {
    get(target, property) {
      if (chooseFrom && property === "from") {
        return (table: unknown) => routedBuilder(databaseForTable(table).select(), false).from(table);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// Preserve the existing Drizzle API while selecting the correct database from
// the table being queried. This keeps legacy account routes on Enzonic and
// migrates chat-table reads/writes to Prisma without changing every route.
export const db = new Proxy(enzonicDb, {
  get(target, property) {
    if (property === "select") return (...args: unknown[]) => {
      const builder = (enzonicDb.select as (...a: unknown[]) => any)(...args);
      return new Proxy(builder, {
        get(inner, key) {
          if (key === "from") return (table: unknown) => {
            const selected = databaseForTable(table);
            return (selected.select as (...a: unknown[]) => any)(...args).from(table);
          };
          const value = Reflect.get(inner, key, inner);
          return typeof value === "function" ? value.bind(inner) : value;
        },
      });
    };
    if (property === "insert" || property === "update" || property === "delete") {
      return (table: unknown) => (databaseForTable(table) as any)[property](table);
    }
    if (property === "execute") return (query: unknown) =>
      (isChatSql(query) ? chatDb : enzonicDb).execute(query as never);
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof enzonicDb;

// Raw SQL is routed by referenced table. Transaction clients remain Enzonic
// by default; chat transaction code should use chatPool.connect() explicitly.
export const pool = new Proxy(enzonicPool, {
  get(target, property) {
    if (property === "query") return (...args: unknown[]) =>
      ((isChatSql(args[0]) ? chatPool : enzonicPool).query as (...a: unknown[]) => any)(...args);
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof enzonicPool;
