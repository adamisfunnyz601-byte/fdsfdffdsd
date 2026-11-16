import { pgTable, integer, text } from "drizzle-orm/pg-core";

// Non-sensitive display projection only; authoritative accounts remain in Enzonic.
export const chatUsers = pgTable("users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  presenceStatus: text("presence_status").notNull().default("offline"),
});
