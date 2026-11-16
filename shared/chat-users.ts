import { pgTable, integer, text } from "drizzle-orm/pg-core";

// Public profile projection mirrored from Enzonic into Prisma for chat joins.
// Never add credentials or private account fields to this table.
export const chatUsers = pgTable("users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  presenceStatus: text("presence_status").notNull().default("offline"),
  role: text("role").notNull().default("user"),
  nickname: text("nickname"),
  pronouns: text("pronouns"),
  usernameFont: text("username_font"),
  tagSymbol: text("tag_symbol"),
  tagText: text("tag_text"),
  tagColor: text("tag_color"),
});
