
import { db, pool, chatPool, enzonicPool } from "./db";
import { users, accessKeys, searchHistory, messages, groupChats, groupChatMembers, customEmojis, friendRequests, blocks, moderationLogs, blockBlastScores, dihhroAwards, communityServers, communityServerMembers, communityServerCategories, communityServerChannels, communityServerMessages, chatMessageReactions, chatPolls, chatPollOptions, chatPollVotes, passkeyCredentials } from "@shared/schema";
import { eq, desc, and, or, gt, sql, inArray } from "drizzle-orm";
import type { Express, Request } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import {
  PROFILE_TAG_COLORS,
  PROFILE_TAG_SYMBOLS,
  isProfileTagColor,
  isProfileTagSymbol,
  normalizeProfileTagText,
} from "@shared/profile-tag";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";

const hashAccountPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
};
const verifyAccountPassword = (password: string, stored: string) => {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, "hex"));
};
declare module "express-session" {
  interface SessionData {
    passkeyFlow?: { challenge: string; userId: number; purpose: "register" | "login"; expiresAt: number };
  }
}

const PgSessionStore = connectPgSimple(session);
const OWNER_KEY = process.env.OWNER_KEY || "";
const PRESENCE_STATUSES = ["online", "idle", "dnd", "offline"] as const;
type ProfileImageKind = "avatar" | "banner";
type ProfileImageVariant = "thumbnail" | "full";
const PROFILE_IMAGE_DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i;
const PROFILE_THUMBNAIL_CACHE_LIMIT = 32;
const profileThumbnailCache = new Map<string, Buffer>();
const profileThumbnailJobs = new Map<string, Promise<Buffer>>();

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many sign-in attempts. Try again in a few minutes." },
});

const accessRequestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many access requests. Try again later." },
});

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function profileImageUrl(
  userId: number,
  kind: ProfileImageKind,
  value: unknown,
  variant: ProfileImageVariant = "thumbnail",
): unknown {
  if (typeof value !== "string") return value ?? null;
  const match = PROFILE_IMAGE_DATA_URL.exec(value);
  if (!match) return value;
  const version = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${(process.env.APP_ORIGIN || process.env.PUBLIC_API_URL || "https://nexuss.devs.li").replace(/[/]+$/, "")}/api/profile-images/${userId}/${kind}/${variant}/${version}`;
}

function isProfileImageProxyUrl(value: unknown, userId: number, kind: ProfileImageKind): boolean {
  return typeof value === "string"
    && new RegExp(`^/api/profile-images/${userId}/${kind}/(?:thumbnail|full)/[a-f0-9]{24}$`).test(value);
}

async function getProfileThumbnail(
  cacheKey: string,
  source: Buffer,
  kind: ProfileImageKind,
): Promise<Buffer> {
  const cached = profileThumbnailCache.get(cacheKey);
  if (cached) {
    profileThumbnailCache.delete(cacheKey);
    profileThumbnailCache.set(cacheKey, cached);
    return cached;
  }

  const pending = profileThumbnailJobs.get(cacheKey);
  if (pending) return pending;

  const job = sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(kind === "avatar"
      ? { width: 256, height: 256, fit: "cover", withoutEnlargement: true }
      : { width: 1280, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: kind === "avatar" ? 48 : 54, effort: 3 })
    .toBuffer();
  profileThumbnailJobs.set(cacheKey, job);

  try {
    const thumbnail = await job;
    profileThumbnailCache.set(cacheKey, thumbnail);
    while (profileThumbnailCache.size > PROFILE_THUMBNAIL_CACHE_LIMIT) {
      const oldestKey = profileThumbnailCache.keys().next().value;
      if (oldestKey === undefined) break;
      profileThumbnailCache.delete(oldestKey);
    }
    return thumbnail;
  } finally {
    profileThumbnailJobs.delete(cacheKey);
  }
}

// Extend session type
declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
  }
}


async function syncChatUserProjection() {
  // Keep only the public fields required by chat queries in Prisma Postgres.
  // Use one fixed-shape upsert per user: Prisma's connection proxy can reject
  // dynamically-sized multi-row prepared statements with bind-count errors.
  const { rows } = await enzonicPool.query(
    `SELECT id, username, display_name, avatar_url, presence_status,
            role, nickname, pronouns, username_font, tag_symbol, tag_text, tag_color
       FROM users`,
  );

  for (const row of rows) {
    await chatPool.query(
      `INSERT INTO users
         (id, username, display_name, avatar_url, presence_status, role,
          nickname, pronouns, username_font, tag_symbol, tag_text, tag_color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         username=EXCLUDED.username,
         display_name=EXCLUDED.display_name,
         avatar_url=EXCLUDED.avatar_url,
         presence_status=EXCLUDED.presence_status,
         role=EXCLUDED.role,
         nickname=EXCLUDED.nickname,
         pronouns=EXCLUDED.pronouns,
         username_font=EXCLUDED.username_font,
         tag_symbol=EXCLUDED.tag_symbol,
         tag_text=EXCLUDED.tag_text,
         tag_color=EXCLUDED.tag_color`,
      [row.id, row.username, row.display_name, row.avatar_url, row.presence_status,
       row.role, row.nickname, row.pronouns, row.username_font, row.tag_symbol,
       row.tag_text, row.tag_color],
    );
  }

  const keepIds = rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isSafeInteger(id) && id > 0);
  if (keepIds.length) {
    await chatPool.query(`DELETE FROM users WHERE id <> ALL(ARRAY[${keepIds.join(",")}]::int[])`);
  } else {
    await chatPool.query("DELETE FROM users");
  }
}

async function syncChatBlockProjection() {
  const { rows } = await enzonicPool.query("SELECT blocker_id, blocked_id FROM blocks");
  await chatPool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id BIGSERIAL PRIMARY KEY,
      blocker_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (blocker_id, blocked_id)
    )
  `);
  await chatPool.query("DELETE FROM blocks");
  for (const row of rows) {
    await chatPool.query(
      "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING",
      [row.blocker_id, row.blocked_id],
    );
  }
}

async function ensureChatUserProjection() {
  await chatPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      presence_status TEXT NOT NULL DEFAULT 'offline',
      role TEXT NOT NULL DEFAULT 'user',
      nickname TEXT,
      pronouns TEXT,
      username_font TEXT,
      tag_symbol TEXT,
      tag_text TEXT,
      tag_color TEXT
    )
  `);
  // Upgrade installations that already have the original minimal projection.
  await chatPool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS nickname TEXT,
      ADD COLUMN IF NOT EXISTS pronouns TEXT,
      ADD COLUMN IF NOT EXISTS username_font TEXT,
      ADD COLUMN IF NOT EXISTS tag_symbol TEXT,
      ADD COLUMN IF NOT EXISTS tag_text TEXT,
      ADD COLUMN IF NOT EXISTS tag_color TEXT
  `);
  await syncChatBlockProjection();
  await syncChatUserProjection();
  const timer = setInterval(() => {
    void db.execute(sql.raw("UPDATE users SET presence_status='offline' WHERE presence_status <> 'offline' AND (last_seen IS NULL OR last_seen < NOW() - INTERVAL '90 seconds')"))
      .catch(error => console.error("[presence-expiry] Failed:", error));
    void syncChatUserProjection().catch(error => console.error("[chat-user-sync] Failed:", error));
    void syncChatBlockProjection().catch(error => console.error("[chat-block-sync] Failed:", error));
  }, 30_000);
  timer.unref?.();
}

async function ensureSessionStoreTable() {
  // Create the connect-pg-simple schema directly through Drizzle before the
  // session middleware is registered. This avoids relying on table.sql being
  // present beside a bundled dist/index.cjs on Windows/self-hosted installs.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire
    ON user_sessions (expire)
  `));
}

async function ensureChatGifTable() {
  await chatPool.query(`
    CREATE TABLE IF NOT EXISTS nexus_chat_gif_attachments (
      filename TEXT PRIMARY KEY CHECK (filename ~ '^[a-f0-9]{40}\\.gif$'),
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureVoiceCallTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS nexus_voice_calls (
      call_id TEXT PRIMARY KEY,
      caller_id INTEGER NOT NULL,
      callee_id INTEGER NOT NULL,
      with_video BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'ringing',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '45 seconds')
    )
  `));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS nexus_voice_signals (
      id BIGSERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL,
      call_id TEXT,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS nexus_voice_signals_recipient_idx ON nexus_voice_signals(recipient_id, id)`));
}

async function ensureCommunityServerTables() {
  // These idempotent DDL statements keep fresh deployments from exposing
  // server screens whose backing tables were never created by a manual db:push.
  const statements = [
    `CREATE TABLE IF NOT EXISTS community_servers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      invite_code TEXT NOT NULL UNIQUE,
      owner_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS community_server_members (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS community_server_member_unique
      ON community_server_members(server_id, user_id)`,
    `CREATE TABLE IF NOT EXISTS community_server_categories (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS community_server_channels (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES community_server_categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      topic TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    `CREATE TABLE IF NOT EXISTS passkey_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      credential_id TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS dihtro_gifts (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 24),
      tier TEXT NOT NULL DEFAULT 'bronze',
      claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      claimed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `ALTER TABLE dihtro_gifts ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'bronze'`,
    `ALTER TABLE dihtro_gifts ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP`,
    `ALTER TABLE dihtro_gifts ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
    `CREATE TABLE IF NOT EXISTS dihhro_awards (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      month_key TEXT NOT NULL UNIQUE,
      score INTEGER NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS community_server_messages (
      id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES community_servers(id) ON DELETE CASCADE,
      channel_id INTEGER NOT NULL REFERENCES community_server_channels(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      edited_at TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS apple_2fa_challenges (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'waiting',
      code_ciphertext TEXT,
      code_iv TEXT,
      code_tag TEXT,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS apple_2fa_challenges_expiry_idx ON apple_2fa_challenges(expires_at)`,
    `CREATE TABLE IF NOT EXISTS nexus_chat_mention_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, message_id)
    )`,
    `CREATE INDEX IF NOT EXISTS nexus_chat_mentions_user_idx ON nexus_chat_mention_notifications(user_id, id)`,
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Safe additive Enzonic migration: keep existing accounts and subscriptions intact.
  await enzonicPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'none'`);
  await enzonicPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_emotes BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS mute_non_friend_calls BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS dm_friends_only BOOLEAN NOT NULL DEFAULT FALSE`);
  await ensureChatUserProjection();
  await ensureCommunityServerTables();
  // Promote the existing, reserved AdamisFunnyz account to the internal super-owner role.
  const [bootstrapSuperOwner] = await db.select({ id: users.id }).from(users)
    .where(sql`lower(trim(${users.username})) = 'adamisfunnyz'`).orderBy(users.id).limit(1);
  if (bootstrapSuperOwner) {
    await db.update(users).set({ role: "super_owner" }).where(eq(users.id, bootstrapSuperOwner.id));
  }
  await ensureSessionStoreTable();
  await ensureVoiceCallTables();
  await ensureChatGifTable();
  // Session middleware. Store sessions in Enzonic so logins survive server restarts.
  // The table is created automatically on first boot by connect-pg-simple.
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a stable random value of at least 32 characters.");
  }
  app.use(
    session({
      name: "nexus.sid",
      store: new PgSessionStore({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: false,
        pruneSessionInterval: 15 * 60,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      proxy: process.env.NODE_ENV === "production",
      cookie: {
        httpOnly: true,
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        secure: process.env.NODE_ENV === "production",
      },
    })
  );

  // Tunnelto terminates HTTPS before forwarding requests to the local server.
  // Trust the forwarded protocol and set cross-origin cookies for Capacitor
  // clients only when the original request was HTTPS; local HTTP development
  // retains Lax cookies so browsers do not reject insecure SameSite=None.
  app.use((req, _res, next) => {
    const isHttpsRequest = req.secure || req.get("x-forwarded-proto") === "https";
    req.session.cookie.secure = isHttpsRequest;
    req.session.cookie.sameSite = isHttpsRequest ? "none" : "lax";
    next();
  });

  // Middleware to check auth
  const requireAuth = (req: Request, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized: Login required" });
    }
    next();
  };

  const requireOwner = async (req: Request, res: any, next: any) => {
    if (!req.session.userId) return res.status(403).json({ message: "Forbidden: Owner access only" });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !["owner", "super_owner"].includes(String(actor.role).toLowerCase())) {
      return res.status(403).json({ message: "Forbidden: Owner access only" });
    }
    next();
  };
  const requireAdmin = async (req: Request, res: any, next: any) => {
    if (!req.session.userId) return res.status(401).json({ message: "Login required." });
    const actor = await storage.getUser(req.session.userId);
    if (!actor || !["owner","admin","super_owner"].includes(String(actor.role).toLowerCase())) return res.status(403).json({ message: "Owner or Admin access required." });
    next();
  };

  // Global NEXUS crash-screen switch. The state is persistent across restarts.
  await pool.query(`CREATE TABLE IF NOT EXISTS nexus_crash_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    error_code TEXT NOT NULL DEFAULT 'NEXUS-0x0001',
    details TEXT NOT NULL DEFAULT 'A Super Owner has temporarily activated maintenance mode.',
    triggered_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO nexus_crash_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  app.get("/api/system/crash-state", requireAuth, async (req, res) => {
    const actor = await storage.getUser(Number(req.session.userId));
    const isSuperOwner = !!actor && canonicalRole(actor.role) === "super-owner";
    const result = await pool.query("SELECT active, error_code AS \"errorCode\", details, updated_at AS \"updatedAt\" FROM nexus_crash_state WHERE id = 1");
    return res.json({ ...(result.rows[0] || { active: false, errorCode: "NEXUS-0x0001", details: "" }), isSuperOwner });
  });
  app.post("/api/super-owner/crash-screen/trigger", requireAuth, async (req, res) => {
    const actor = await storage.getUser(Number(req.session.userId));
    if (!actor || canonicalRole(actor.role) !== "super-owner") return res.status(403).json({ message: "Super Owner access required." });
    const code = String(req.body?.errorCode || "NEXUS-0x0001").trim().slice(0, 40);
    const details = String(req.body?.details || "A Super Owner has temporarily activated maintenance mode.").trim().slice(0, 240);
    await pool.query("UPDATE nexus_crash_state SET active = TRUE, error_code = $1, details = $2, triggered_by = $3, updated_at = NOW() WHERE id = 1", [code, details, actor.id]);
    await db.insert(moderationLogs).values({ actorId: actor.id, action: "super-owner:trigger-crash-screen", reason: details, metadata: { errorCode: code } });
    return res.json({ success: true, active: true, errorCode: code });
  });
  app.post("/api/super-owner/crash-screen/clear", requireAuth, async (req, res) => {
    const actor = await storage.getUser(Number(req.session.userId));
    if (!actor || canonicalRole(actor.role) !== "super-owner") return res.status(403).json({ message: "Super Owner access required." });
    await pool.query("UPDATE nexus_crash_state SET active = FALSE, updated_at = NOW() WHERE id = 1", []);
    await db.insert(moderationLogs).values({ actorId: actor.id, action: "super-owner:clear-crash-screen", reason: "Crash screen disabled" });
    return res.json({ success: true, active: false });
  });


  // Local yt-dlp conversion. Output is written to an OS temporary directory and streamed to the client;
  // no media bytes, conversion jobs, source URLs, or download history are written to either database.
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readdir, rm, stat } = await import("node:fs/promises");
  const { createReadStream } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, basename } = await import("node:path");
  const youtubeConvertRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many conversions. Wait a minute and try again." },
  });
  let activeYoutubeConversions = 0;
  app.post("/api/youtube/convert", requireAuth, youtubeConvertRateLimit, async (req, res) => {
    const source = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const format = ["mp3", "mp4", "mov"].includes(req.body?.format) ? req.body.format as "mp3" | "mp4" | "mov" : "";
    const quality = typeof req.body?.quality === "string" ? req.body.quality : "";
    let parsed: URL;
    try { parsed = new URL(source); } catch { return res.status(400).json({ message: "Enter a valid YouTube video URL." }); }
    if (parsed.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(parsed.hostname.toLowerCase())) {
      return res.status(400).json({ message: "Only HTTPS YouTube video links are supported." });
    }
    if (!format) return res.status(400).json({ message: "Choose MP3, MP4 or MOV." });
    const validQuality = format === "mp3" ? ["128", "192", "256", "320"].includes(quality)
      : ["360", "480", "720", "1080", "1440", "best"].includes(quality);
    if (!validQuality) return res.status(400).json({ message: "Choose a supported quality." });
    if (activeYoutubeConversions >= 2) return res.status(429).json({ message: "NEXUS is already converting two files. Try again shortly." });

    const { resolve, dirname } = await import("node:path");
    const { existsSync, statSync } = await import("node:fs");
    // In serverless deployments process.cwd() can be the function directory,
    // while the bundled entrypoint itself lives in dist/. Search both roots.
    const runtimeDir = typeof __dirname === "string" ? __dirname : process.cwd();
    const roots = [process.cwd(), runtimeDir, dirname(runtimeDir)];
    const binCandidates = [...new Set(roots.flatMap(root => [
      resolve(root, "dist", "vendor", "bin"),
      resolve(root, "vendor", "bin"),
      resolve(root, "vendor", "media-tools"),
    ]))];
    const absoluteConfiguredPath = (value: string) => value
      ? (value.startsWith("/") || /^[A-Za-z]:[\\\\/]/.test(value) ? resolve(value) : resolve(process.cwd(), value))
      : "";
    const configuredYtdlp = absoluteConfiguredPath(String(process.env.YTDLP_PATH || "").trim());
    const configuredBin = absoluteConfiguredPath(String(process.env.FFMPEG_LOCATION || "").trim());
    const executableName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const ytdlpCandidates = [...new Set([configuredYtdlp, ...binCandidates.map(dir => resolve(dir, executableName))].filter(Boolean))];
    const ytdlpPath = ytdlpCandidates.find(candidate => {
      try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
    });
    const ffmpegLocation = [configuredBin, ...binCandidates].find(dir => {
      try { return !!dir && existsSync(resolve(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")); } catch { return false; }
    }) || binCandidates[0];
    if (!ytdlpPath) {
      throw Object.assign(new Error(`yt-dlp executable not found. cwd=${process.cwd()}; runtimeDir=${runtimeDir}; checked: ${ytdlpCandidates.join(", ")}`), { code: "ENOENT" });
    }
    console.log(`[youtube-converter] Using yt-dlp at ${ytdlpPath}; FFmpeg directory ${ffmpegLocation}; cwd=${process.cwd()}`);
    const workDir = await mkdtemp(join(tmpdir(), "nexus-ytdlp-"));
    const outputTemplate = join(workDir, "%(id)s.%(ext)s");
    const args = [
      "--no-playlist", "--no-warnings", "--no-progress", "--no-part",
      "--restrict-filenames", "--max-filesize", "500M",
      "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2",
      "--output", outputTemplate,
    ];
    if (ffmpegLocation) args.push("--ffmpeg-location", ffmpegLocation);
    if (format === "mp3") {
      args.push("-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", `${quality}K`);
    } else {
      // Prefer H.264 + AAC for MP4 so the resulting file plays in iOS Safari,
      // Android browsers and the built-in Photos/Gallery players. Avoid AV1/VP9
      // streams that can be packaged in an MP4 container but aren't universally supported.
      const formatSelector = format === "mp4"
        ? (quality === "best"
          ? "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[ext=mp4][vcodec^=avc1]/best[ext=mp4]"
          : `bestvideo[height<=${quality}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=${quality}][ext=mp4][vcodec^=avc1]/best[ext=mp4]`)
        : (quality === "best" ? "bestvideo+bestaudio/best"
          : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`);
      args.push("-f", formatSelector);
      if (format === "mp4") {
        args.push("--merge-output-format", "mp4", "--postprocessor-args", "Merger+ffmpeg_o:-movflags +faststart");
      } else args.push("--remux-video", "mov");
    }
    args.push("--", parsed.toString());

    activeYoutubeConversions += 1;
    let child: ReturnType<typeof spawn> | undefined;
    let settled = false;
    try {
      await new Promise<void>((resolve, reject) => {
        child = spawn(ytdlpPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
        let stderr = "";
        const timeout = setTimeout(() => child?.kill("SIGKILL"), 8 * 60 * 1000);
        child.stderr?.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-5000); });
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.once("close", code => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new Error(stderr || `yt-dlp exited with code ${code ?? "unknown"}`));
        });
      });
      const files = (await readdir(workDir)).filter(name => /\.(mp3|mp4|mov)$/i.test(name));
      if (!files.length) throw new Error("yt-dlp finished but did not produce an MP3, MP4 or MOV file. Check that FFmpeg is installed.");
      const filePath = join(workDir, files[0]);
      const fileInfo = await stat(filePath);
      if (!fileInfo.isFile() || fileInfo.size <= 0 || fileInfo.size > 500 * 1024 * 1024) throw new Error("The converted file is empty or exceeds the 500 MB limit.");
      const safeName = basename(files[0]).replace(/[\r\n"]/g, "_");
      const contentType = format === "mp3" ? "audio/mpeg" : format === "mov" ? "video/quicktime" : "video/mp4";
      res.set({
        "Content-Type": contentType,
        "Content-Length": String(fileInfo.size),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      });
      const cleanup = () => { void rm(workDir, { recursive: true, force: true }).catch(() => undefined); };
      res.once("close", cleanup);
      res.once("finish", cleanup);
      const stream = createReadStream(filePath);
      stream.once("error", error => { cleanup(); if (!res.headersSent) res.status(500).json({ message: "Could not stream the converted file." }); else res.destroy(error); });
      stream.pipe(res);
      settled = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[youtube-converter] conversion failed:", message);
      const missingBinary = (error as NodeJS.ErrnoException)?.code === "ENOENT";
      const userMessage = missingBinary
        ? "The bundled yt-dlp executable is missing. Redeploy so the media-tools build step can install it."
        : /ffmpeg|ffprobe/i.test(message)
          ? "The bundled FFmpeg/FFprobe tools are missing. Redeploy so the media-tools build step can install them."
          : /timed out|SIGKILL/i.test(message)
            ? "The conversion took too long and was stopped. Try a shorter video or lower quality."
            : "Conversion failed. The video may be private, restricted, unavailable, or unsupported.";
      if (!res.headersSent) res.status(502).json({ message: userMessage });
    } finally {
      activeYoutubeConversions = Math.max(0, activeYoutubeConversions - 1);
      if (!settled) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  const blockedEitherWay = async (userId: number, otherId: number) => {
    const [block] = await db.select({ id: blocks.id }).from(blocks).where(
      or(
        and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)),
        and(eq(blocks.blockerId, otherId), eq(blocks.blockedId, userId)),
      ),
    ).limit(1);
    return !!block;
  };

  const safeUser = (user: any) => {
    if (!user) return user;
    const { serialKey: _serialKey, passwordHash: _passwordHash, ...safe } = user;
    return {
      ...safe,
      // Keep the super-owner's public role label/badge as "owner".
      role: String(safe.role).toLowerCase() === "super_owner" ? "owner" : safe.role,
      isSuperOwner: String(safe.role).toLowerCase() === "super_owner",
      avatarUrl: profileImageUrl(safe.id, "avatar", safe.avatarUrl),
      bannerUrl: profileImageUrl(safe.id, "banner", safe.bannerUrl),
    };
  };

  // Private Apple 2FA relay. Only the exact AdamisFunnyz account may create or submit codes.
  const isAppleRelayOwner = async (req: Request) => {
    const account = await storage.getUser(Number(req.session.userId));
    return String(account?.username || "").trim().toLowerCase() === "adamisfunnyz";
  };
  const appleRelayKey = () => {
    const secret = process.env.APPLE_2FA_RELAY_SECRET || "";
    if (secret.length < 40) throw new Error("APPLE_2FA_RELAY_SECRET is not configured.");
    return createHash("sha256").update(secret).digest();
  };
  const encryptAppleCode = (code: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", appleRelayKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
    return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  };
  const decryptAppleCode = (ciphertext: string, iv: string, tag: string) => {
    const decipher = createDecipheriv("aes-256-gcm", appleRelayKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  };

  app.post("/api/apple-auth/challenges", requireAuth, async (req, res) => {
    if (!await isAppleRelayOwner(req)) return res.status(403).json({ message: "This feature is restricted to AdamisFunnyz." });
    const id = randomBytes(24).toString("base64url");
    await pool.query("DELETE FROM apple_2fa_challenges WHERE expires_at <= NOW() OR state = 'consumed'");
    await pool.query(
      "INSERT INTO apple_2fa_challenges (id, user_id, state, expires_at) VALUES ($1, $2, 'waiting', NOW() + INTERVAL '5 minutes')",
      [id, Number(req.session.userId)]
    );
    return res.status(201).json({ challengeId: id, expiresIn: 300 });
  });

  app.post("/api/apple-auth/challenges/:id/code", requireAuth, async (req, res) => {
    if (!await isAppleRelayOwner(req)) return res.status(403).json({ message: "This feature is restricted to AdamisFunnyz." });
    const code = String(req.body?.code || "").trim();
    if (!/^[0-9]{4,8}$/.test(code)) return res.status(400).json({ message: "Enter the verification code from Apple." });
    const encrypted = encryptAppleCode(code);
    const saved = await pool.query(
      "UPDATE apple_2fa_challenges SET state = 'code_ready', code_ciphertext = $1, code_iv = $2, code_tag = $3 WHERE id = $4 AND user_id = $5 AND state = 'waiting' AND expires_at > NOW() RETURNING id",
      [encrypted.ciphertext, encrypted.iv, encrypted.tag, String(req.params.id), Number(req.session.userId)]
    );
    if (!saved.rows.length) return res.status(410).json({ message: "This challenge has expired or has already been used. Create a new one." });
    return res.json({ success: true, message: "Code submitted securely. Waiting for Apple sign-in to continue." });
  });

  app.post("/api/internal/apple-auth/:id/poll", async (req, res) => {
    const supplied = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const configured = process.env.APPLE_2FA_RELAY_SECRET || "";
    if (!configured || supplied.length !== configured.length ||
        !timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(configured).digest())) {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const client = await pool.connect();
    let row: any = null;
    let missing = false;
    try {
      await client.query("BEGIN");
      const ready = await client.query(
        "SELECT code_ciphertext, code_iv, code_tag FROM apple_2fa_challenges WHERE id = $1 AND state = 'code_ready' AND expires_at > NOW() FOR UPDATE",
        [String(req.params.id)]
      );
      if (ready.rows.length) {
        row = ready.rows[0];
        await client.query(
          "UPDATE apple_2fa_challenges SET state = 'consumed', code_ciphertext = NULL, code_iv = NULL, code_tag = NULL WHERE id = $1",
          [String(req.params.id)]
        );
      } else {
        const exists = await client.query("SELECT id FROM apple_2fa_challenges WHERE id = $1 AND expires_at > NOW() LIMIT 1", [String(req.params.id)]);
        missing = !exists.rows.length;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!row) {
      if (missing) return res.status(410).json({ message: "Challenge expired or missing." });
      return res.status(202).json({ waiting: true });
    }
    const code = decryptAppleCode(row.code_ciphertext, row.code_iv, row.code_tag);
    return res.json({ code });
  });

  // GS (Galaxy Subscription) status, purchases and one-time gift links.
  app.get(["/api/gs/me", "/api/dihtro/me"], requireAuth, async (req, res) => {
    const account = await storage.getUser(Number(req.session.userId!));
    if (!account) return res.status(404).json({ message: "Account not found." });
    const until = account.dihhroUntil ? new Date(account.dihhroUntil) : null;
    const role = String(account.role).toLowerCase();
    const isStaff = ["owner", "admin", "super_owner"].includes(role);
    const active = isStaff || Boolean(until && until.getTime() > Date.now());
    const storedTier = String(account.subscriptionTier || "none");
    const tier = isStaff ? "diamond" : active ? (storedTier === "none" ? "bronze" : storedTier) : "none";
    return res.json({ active, tier, until: isStaff ? null : until?.toISOString() || null, isStaff, isSuperOwner: role === "super_owner", prices: { bronze: 250, silver: 750, gold: 1800, diamond: 4000 } });
  });

  app.post(["/api/gs/purchase", "/api/dihtro/purchase"], requireAuth, async (req, res) => {
    const tier = String(req.body?.tier || "").toLowerCase();
    const prices: Record<string, number> = { bronze: 250, silver: 750, gold: 1800, diamond: 4000 };
    const price = prices[tier];
    if (!price) return res.status(400).json({ message: "Choose a valid GS subscription." });
    const userId = Number(req.session.userId!);
    const account = await storage.getUser(userId);
    if (!account) return res.status(404).json({ message: "Account not found." });
    if (["owner", "admin", "super_owner"].includes(String(account.role).toLowerCase())) {
      return res.status(400).json({ message: "Staff already have permanent Universe Diamond access." });
    }
    const tierRank: Record<string, number> = { none: 0, bronze: 1, silver: 2, gold: 3, diamond: 4 };
    const activeSubscription = Boolean(account.dihhroUntil && new Date(account.dihhroUntil) > new Date());
    const storedTier = String(account.subscriptionTier || "none");
    const existingTier = activeSubscription ? (storedTier === "none" ? "bronze" : storedTier) : "none";
    if ((tierRank[existingTier] || 0) > tierRank[tier]) return res.status(400).json({ message: "You already have a higher active GS subscription." });
    const balance = Number(account.coins || 0);
    if (!Number.isSafeInteger(balance) || balance < price) return res.status(400).json({ message: "Not enough Galactic Coins." });
    const now = new Date();
    const oldExpiry = account.dihhroUntil && new Date(account.dihhroUntil) > now ? new Date(account.dihhroUntil) : now;
    const until = new Date(oldExpiry); until.setUTCMonth(until.getUTCMonth() + 1);
    await db.update(users).set({ coins: String(balance - price), subscriptionTier: tier, dihhroUntil: until }).where(eq(users.id, userId));
    return res.json({ success: true, tier, coins: balance - price, until: until.toISOString() });
  });

  app.post(["/api/gs/gifts", "/api/dihtro/gifts"], requireAdmin, async (req, res) => {
    const months = Number(req.body?.months);
    const tier = String(req.body?.tier || "bronze").toLowerCase();
    const actor = await storage.getUser(Number(req.session.userId!));
    const isSuperOwner = String(actor?.role || "").toLowerCase() === "super_owner";
    if (!Number.isInteger(months) || months < 1 || months > 24) return res.status(400).json({ message: "Gift duration must be between 1 and 24 months." });
    if (!["bronze", "silver", "gold"].includes(tier) && !(tier === "diamond" && isSuperOwner)) return res.status(403).json({ message: "Only super owners can create Universe Diamond gifts." });
    const code = randomBytes(24).toString("base64url");
    const result = await pool.query(
      "INSERT INTO dihtro_gifts (code, created_by, months, tier) VALUES ($1, $2, $3, $4) RETURNING code, months, tier, created_at",
      [code, Number(req.session.userId!), months, tier],
    );
    const requestProtocol = req.get("x-forwarded-proto") || req.protocol;
    const requestHost = req.get("x-forwarded-host") || req.get("host");
    const appOrigin = (process.env.APP_ORIGIN || `${requestProtocol}://${requestHost}`).replace(/\/+$/, "");
    return res.status(201).json({ ...result.rows[0], claimPath: `/gs/claim/${code}`, claimUrl: `${appOrigin}/gs/claim/${code}` });
  });

  app.get(["/api/gs/gifts", "/api/dihtro/gifts"], requireAdmin, async (_req, res) => {
    const result = await pool.query(
      `SELECT g.code, g.months, g.tier, g.created_at AS "createdAt", g.claimed_at AS "claimedAt",
              g.claimed_by AS "claimedBy", g.revoked_at AS "revokedAt", creator.username AS "createdByName", claimant.username AS "claimedByName"
       FROM dihtro_gifts g
       LEFT JOIN users creator ON creator.id = g.created_by
       LEFT JOIN users claimant ON claimant.id = g.claimed_by
       ORDER BY g.created_at DESC LIMIT 200`,
    );
    return res.json(result.rows);
  });

  app.post("/api/super-owner/gs/gifts/:code/revoke", requireAuth, async (req, res) => {
    const actor = await storage.getUser(Number(req.session.userId!));
    if (!actor || canonicalRole(actor.role) !== "super-owner") return res.status(403).json({ message: "Super Owner access required." });
    const code = String(req.params.code || "").trim();
    if (!code || code.length > 128) return res.status(400).json({ message: "Invalid gift code." });
    const revoked = await pool.query("UPDATE dihtro_gifts SET revoked_at = NOW(), revoked_by = $1 WHERE code = $2 AND revoked_at IS NULL RETURNING code, claimed_at", [actor.id, code]);
    if (!revoked.rows.length) {
      const existing = await pool.query("SELECT revoked_at FROM dihtro_gifts WHERE code = $1 LIMIT 1", [code]);
      if (!existing.rows.length) return res.status(404).json({ message: "Gift link not found." });
      return res.status(409).json({ message: "This gift link has already been revoked." });
    }
    await db.insert(moderationLogs).values({ actorId: actor.id, action: "super-owner:revoke-gift-link", reason: "Revoked GS gift link", metadata: { code, claimed: Boolean(revoked.rows[0].claimed_at) } });
    return res.json({ success: true, code, revoked: true });
  });

  app.get(["/api/gs/gifts/:code", "/api/dihtro/gifts/:code"], async (req, res) => {
    const result = await pool.query(
      "SELECT code, months, tier, claimed_at, created_at, revoked_at FROM dihtro_gifts WHERE code = $1 LIMIT 1",
      [String(req.params.code)],
    );
    if (!result.rows.length || result.rows[0].revoked_at) return res.status(404).json({ message: "This GS gift link is invalid or has been revoked." });
    const gift = result.rows[0];
    return res.json({ months: gift.months, tier: gift.tier || "bronze", claimed: Boolean(gift.claimed_at), createdAt: gift.created_at });
  });

  app.post(["/api/gs/gifts/:code/claim", "/api/dihtro/gifts/:code/claim"], requireAuth, async (req, res) => {
    const code = String(req.params.code || "");
    const userId = Number(req.session.userId!);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        "UPDATE dihtro_gifts SET claimed_by = $1, claimed_at = NOW() WHERE code = $2 AND claimed_at IS NULL AND revoked_at IS NULL RETURNING months, tier",
        [userId, code],
      );
      if (!claimed.rows.length) {
        const exists = await client.query("SELECT code, revoked_at FROM dihtro_gifts WHERE code = $1 LIMIT 1", [code]);
        await client.query("ROLLBACK");
        if (!exists.rows.length || exists.rows[0].revoked_at) return res.status(410).json({ message: "This GS gift link has been revoked or is invalid." });
        return res.status(409).json({ message: "This one-time GS gift has already been claimed." });
      }
      const gift = claimed.rows[0];
      const accountResult = await client.query("SELECT dihhro_until, subscription_tier FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!accountResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Account not found." });
      }
      const account = accountResult.rows[0];
      const now = new Date();
      const currentExpiry = account.dihhro_until ? new Date(account.dihhro_until) : now;
      const hasActiveSubscription = currentExpiry > now;
      const startAt = hasActiveSubscription ? currentExpiry : now;
      const until = new Date(startAt);
      until.setUTCMonth(until.getUTCMonth() + Number(gift.months));
      const tierRank: Record<string, number> = { none: 0, bronze: 1, silver: 2, gold: 3, diamond: 4 };
      const currentTier = hasActiveSubscription ? String(account.subscription_tier || "none") : "none";
      const giftTier = String(gift.tier || "bronze");
      const effectiveTier = (tierRank[currentTier] || 0) > (tierRank[giftTier] || 0) ? currentTier : giftTier;
      await client.query("UPDATE users SET subscription_tier = $1, dihhro_until = $2 WHERE id = $3", [effectiveTier, until, userId]);
      await client.query("COMMIT");
      return res.json({ success: true, months: Number(gift.months), tier: effectiveTier, until: until.toISOString() });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  // Passkey registration and authentication use WebAuthn challenges stored in the session.
  const getWebAuthnSettings = (req: Request) => {
    // Web and Capacitor apps have different valid WebAuthn origins. Derive the
    // origin from the actual client request so passkeys work on web, iOS and Android.
    const requestOrigin = typeof req.headers.origin === "string" && req.headers.origin !== "null"
      ? req.headers.origin
      : undefined;
    const configuredOrigin = requestOrigin || process.env.WEBAUTHN_ORIGIN
      || (process.env.NODE_ENV !== "production" ? `http://localhost:${process.env.PORT || 5000}` : "");
    if (!configuredOrigin) throw new Error("Set WEBAUTHN_ORIGIN or send a valid app Origin header to enable passkeys.");
    const parsed = new URL(configuredOrigin);
    const isLocalAppOrigin = parsed.hostname === "localhost" && ["capacitor:", "https:", "http:"].includes(parsed.protocol);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !isLocalAppOrigin) {
      throw new Error("Passkeys require HTTPS or a trusted Capacitor localhost origin.");
    }
    const configuredRpId = process.env.WEBAUTHN_RP_ID;
    const rpID = configuredRpId && (parsed.hostname === configuredRpId || parsed.hostname.endsWith(`.${configuredRpId}`))
      ? configuredRpId
      : parsed.hostname;
    const expectedOrigin = parsed.protocol === "capacitor:" ? configuredOrigin.replace(/\/$/, "") : parsed.origin;
    return { expectedOrigin, rpID };
  };

  app.post("/api/auth/passkeys/register/options", requireAuth, async (req, res) => {
    try {
      const { generateRegistrationOptions } = await import("@simplewebauthn/server");
      const { expectedOrigin, rpID } = getWebAuthnSettings(req);
      const account = await storage.getUser(Number(req.session.userId!));
      if (!account) return res.status(404).json({ message: "NEXUS account not found." });
      const existing = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, account.id));
      const options = await generateRegistrationOptions({
        rpName: "NEXUS",
        rpID,
        userID: Buffer.from(String(account.id)),
        userName: account.username,
        userDisplayName: account.displayName || account.username,
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        excludeCredentials: existing.map(item => ({ id: item.credentialId, transports: item.transports as any })),
      });
      req.session.passkeyFlow = { challenge: options.challenge, userId: account.id, purpose: "register", expiresAt: Date.now() + 120000 };
      await saveSession(req);
      return res.json(options);
    } catch (error: any) {
      console.error("[passkey] Registration options failed:", error?.message || error);
      return res.status(503).json({ message: error?.message || "Could not prepare passkey registration." });
    }
  });

  app.post("/api/auth/passkeys/register/verify", requireAuth, async (req, res) => {
    try {
      const flow = req.session.passkeyFlow;
      if (!flow || flow.purpose !== "register" || flow.userId !== Number(req.session.userId!) || flow.expiresAt < Date.now()) {
        return res.status(400).json({ message: "Passkey registration expired. Try again." });
      }
      const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
      const { expectedOrigin, rpID } = getWebAuthnSettings(req);
      const verification = await verifyRegistrationResponse({
        response: req.body?.response,
        expectedChallenge: flow.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
      if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ message: "Passkey verification failed." });
      const credential = verification.registrationInfo.credential;
      await db.insert(passkeyCredentials).values({
        userId: flow.userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
      }).onConflictDoNothing();
      // Confirm the credential is persisted for this account before reporting success.
      const [savedCredential] = await db.select({ id: passkeyCredentials.id, userId: passkeyCredentials.userId })
        .from(passkeyCredentials).where(eq(passkeyCredentials.credentialId, credential.id)).limit(1);
      if (!savedCredential || savedCredential.userId !== flow.userId) {
        return res.status(409).json({ message: "The passkey was created on this device, but NEXUS could not attach it to this account. Try adding it again, or use your password to sign in." });
      }
      delete req.session.passkeyFlow;
      await saveSession(req);
      return res.json({ verified: true, saved: true, passkey: { id: savedCredential.id } });
    } catch (error: any) {
      console.error("[passkey] Registration verification failed:", error?.message || error);
      return res.status(400).json({ message: error?.message || "Could not verify this passkey." });
    }
  });

  // Passkey management: expose safe metadata only, never public keys or credential secrets.
  app.get("/api/auth/passkeys", requireAuth, async (req, res) => {
    const credentials = await db.select({
      id: passkeyCredentials.id,
      createdAt: passkeyCredentials.createdAt,
      transports: passkeyCredentials.transports,
    }).from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, Number(req.session.userId!)))
      .orderBy(desc(passkeyCredentials.createdAt));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ passkeys: credentials });
  });

  app.delete("/api/auth/passkeys/:id", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid passkey." });
    const [removed] = await db.delete(passkeyCredentials).where(and(
      eq(passkeyCredentials.id, id),
      eq(passkeyCredentials.userId, Number(req.session.userId!)),
    )).returning({ id: passkeyCredentials.id });
    if (!removed) return res.status(404).json({ message: "Passkey not found on this account." });
    return res.json({ success: true, id: removed.id });
  });

  app.post("/api/auth/passkeys/login/options", authRateLimit, async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      if (!username) return res.status(400).json({ message: "Enter your NEXUS username first." });
      const [account] = await db.select().from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1);
      if (!account) return res.status(404).json({ message: "No passkey-enabled account was found." });
      const credentials = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, account.id));
      if (!credentials.length) return res.status(404).json({ message: "This account has no passkeys saved in NEXUS. Sign in with your password, then add a passkey in Settings." });
      const { generateAuthenticationOptions } = await import("@simplewebauthn/server");
      const { rpID } = getWebAuthnSettings(req);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
        allowCredentials: credentials.map(item => ({ id: item.credentialId, transports: item.transports as any })),
      });
      req.session.passkeyFlow = { challenge: options.challenge, userId: account.id, purpose: "login", expiresAt: Date.now() + 120000 };
      await saveSession(req);
      return res.json(options);
    } catch (error: any) {
      console.error("[passkey] Authentication options failed:", error?.message || error);
      return res.status(503).json({ message: error?.message || "Could not prepare passkey sign-in." });
    }
  });

  app.post("/api/auth/passkeys/login/verify", authRateLimit, async (req, res) => {
    try {
      const flow = req.session.passkeyFlow;
      if (!flow || flow.purpose !== "login" || flow.expiresAt < Date.now()) return res.status(400).json({ message: "Passkey sign-in expired. Try again." });
      const credentialId = String(req.body?.response?.id || "");
      const [credential] = await db.select().from(passkeyCredentials)
        .where(and(eq(passkeyCredentials.credentialId, credentialId), eq(passkeyCredentials.userId, flow.userId))).limit(1);
      if (!credential) return res.status(401).json({ message: "This passkey is not registered to that account." });
      const { verifyAuthenticationResponse } = await import("@simplewebauthn/server");
      const { expectedOrigin, rpID } = getWebAuthnSettings(req);
      const verification = await verifyAuthenticationResponse({
        response: req.body?.response,
        expectedChallenge: flow.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
          counter: credential.counter,
          transports: credential.transports as any,
        },
        requireUserVerification: false,
      });
      if (!verification.verified) return res.status(401).json({ message: "Passkey verification failed." });
      await db.update(passkeyCredentials).set({ counter: verification.authenticationInfo.newCounter }).where(eq(passkeyCredentials.id, credential.id));
      const account = await storage.getUser(flow.userId);
      if (!account) return res.status(404).json({ message: "NEXUS account not found." });
      delete req.session.passkeyFlow;
      await regenerateSession(req);
      req.session.userId = account.id;
      req.session.role = account.role;
      await db.update(users).set({ presenceStatus: "online", lastSeen: new Date() }).where(eq(users.id, account.id));
      await saveSession(req);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true });
    } catch (error: any) {
      console.error("[passkey] Authentication verification failed:", error?.message || error);
      return res.status(401).json({ message: error?.message || "Passkey sign-in failed." });
    }
  });

  app.get("/api/profile-images/:id/:kind/:variant/:version", async (req, res) => {
    const userId = Number(req.params.id);
    const kind = req.params.kind;
    const variant = req.params.variant;
    if (
      !Number.isInteger(userId)
      || userId <= 0
      || (kind !== "avatar" && kind !== "banner")
      || (variant !== "thumbnail" && variant !== "full")
    ) {
      return res.status(400).json({ message: "Invalid profile image" });
    }
    const imageColumn = kind === "avatar" ? users.avatarUrl : users.bannerUrl;
    const [row] = await db.select({ imageUrl: imageColumn }).from(users)
      .where(eq(users.id, userId)).limit(1);
    if (!row || typeof row.imageUrl !== "string" || row.imageUrl.length > 16 * 1024 * 1024) {
      return res.status(404).end();
    }
    const image = PROFILE_IMAGE_DATA_URL.exec(row.imageUrl);
    if (!image) return res.status(404).end();
    const currentVersion = createHash("sha256").update(row.imageUrl).digest("hex").slice(0, 24);
    if (req.params.version !== currentVersion) return res.status(404).end();

    const originalBytes = Buffer.from(image[2], "base64");
    if (originalBytes.length > 12 * 1024 * 1024) return res.status(413).end();
    let imageBytes = originalBytes;
    let contentType = image[1];
    if (variant === "thumbnail") {
      try {
        imageBytes = await getProfileThumbnail(`${userId}:${kind}:${currentVersion}`, originalBytes, kind);
        contentType = "image/webp";
      } catch (error) {
        console.error("Profile thumbnail processing failed:", error);
        return res.status(415).end();
      }
    }
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", imageBytes.length);
    return res.send(imageBytes);
  });

  // === AUTH ===
  // Public username/password registration. The random serialKey is retained only
  // for compatibility with the existing users table; it is never shown to users.
  app.post("/api/auth/register", authRateLimit, async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      const acceptedTermsVersion = String(req.body?.acceptedTermsVersion || "");
      if (acceptedTermsVersion !== "2026-11-15") {
        return res.status(400).json({ message: "Please read and accept the current NEXUS Terms and Conditions before creating an account." });
      }
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        return res.status(400).json({ message: "Username must be 3–24 characters and use letters, numbers or underscores." });
      }
      if (username.toLowerCase() === "adamisfunnyz") {
        return res.status(403).json({ message: "That username is reserved." });
      }
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ message: "Password must be between 8 and 128 characters." });
      }
      const [existing] = await db.select({ id: users.id }).from(users)
        .where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1);
      if (existing) return res.status(409).json({ message: "That username is already taken." });

      await db.execute(sql`CREATE TABLE IF NOT EXISTS nexus_terms_acceptances (
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        terms_version text NOT NULL,
        accepted_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, terms_version)
      )`);
      const created = await db.transaction(async tx => {
        const [account] = await tx.insert(users).values({
          username,
          serialKey: "NEXUS_ACCOUNT_" + randomBytes(32).toString("hex"),
          passwordHash: hashAccountPassword(password),
          role: "user",
        }).returning();
        await tx.execute(sql`INSERT INTO nexus_terms_acceptances (user_id, terms_version) VALUES (${account.id}, '2026-11-15')`);
        return account;
      });
      return res.status(201).json({ message: "Account created.", user: safeUser(created) });
    } catch (error) {
      console.error("Account registration failed:", error);
      return res.status(500).json({ message: "Could not create your account right now." });
    }
  });

  app.post(api.auth.login.path, authRateLimit, async (req, res) => {
    try {
      const { serialKey, username } = api.auth.login.input.parse(req.body);
      const cleanUsername = typeof username === "string" ? username.trim() : "";
      let user: any = null;

      // Password accounts are always resolved by username first. A password
      // must never be treated as a global account identifier or serial key.
      if (cleanUsername) {
        const [namedUser] = await db.select().from(users)
          .where(sql`lower(${users.username}) = ${cleanUsername.toLowerCase()}`).limit(1);
        if (namedUser) {
          if (namedUser.passwordHash) {
            if (!verifyAccountPassword(serialKey, namedUser.passwordHash)) {
              return res.status(401).json({ message: "Incorrect username or password." });
            }
          } else if (namedUser.serialKey !== serialKey) {
            return res.status(401).json({ message: "Incorrect username or password." });
          }
          user = namedUser;
        }
      } else {
        // Preserve legacy access-key accounts that sign in without a username.
        user = await storage.getUserBySerial(serialKey);
      }

      // Preserve owner-key sign-in without allowing a password to select a
      // different account by matching its serial key.
      if (!user && serialKey === OWNER_KEY) {
        user = await storage.getUserBySerial(serialKey);
        if (!user) {
          user = await storage.createUser({
            username: String(cleanUsername || "Owner").replace(/\s+/g, "_"),
            serialKey,
            role: "owner",
          });
        }
      }

      // Access keys remain supported for legacy/invite-based accounts.
      if (!user && serialKey !== OWNER_KEY) {
        if (cleanUsername.toLowerCase() === "adamisfunnyz") {
          return res.status(403).json({ message: "That username is reserved." });
        }
        const accessKey = await storage.getAccessKey(serialKey);
        if (!accessKey) {
          return res.status(401).json({ message: "Incorrect username or password." });
        }

        let expiresAt: Date | undefined;
        if (accessKey.type === "limited" && accessKey.durationMinutes) {
          expiresAt = new Date(Date.now() + accessKey.durationMinutes * 60000);
        }

        user = await storage.createUser({
          username: String(cleanUsername || `User-${randomBytes(2).toString("hex")}`).replace(/\s+/g, "_"),
          serialKey,
          role: "user",
          expiresAt,
        });
        await storage.markKeyAsUsed(accessKey.id);
      }

      if (!user) return res.status(401).json({ message: "Incorrect username or password." });

      if (user.expiresAt && new Date() > user.expiresAt) {
        return res.status(401).json({ message: "Account expired" });
      }
      const [activeBan] = await db.select().from(moderationLogs)
        .where(and(eq(moderationLogs.targetId, user.id), sql`${moderationLogs.action} IN ('ban','tempban','permban','softban','unban')`))
        .orderBy(desc(moderationLogs.createdAt)).limit(1);
      if (activeBan && activeBan.action !== "unban" && (!activeBan.expiresAt || activeBan.expiresAt > new Date())) {
        return res.status(403).json({ message: "This account is currently banned." });
      }

      // Rotate and persist the authenticated session before responding.
      await regenerateSession(req);
      req.session.userId = user.id;
      req.session.role = user.role;
      const loginPresence = "online";
      await db.update(users).set({
        presenceStatus: loginPresence,
        lastSeen: new Date(),
      }).where(eq(users.id, user.id));
      await saveSession(req);

      res.setHeader("Cache-Control", "no-store");
      res.json(safeUser({ ...user, presenceStatus: loginPresence, lastSeen: new Date() }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid login details" });
      }
      console.error(err);
      res.status(500).json({ message: "Login failed" });
    }
  });
  // Public invite-link validation. The key itself remains the credential used at signup.
  app.get("/api/invites/:key", async (req, res) => {
    try {
      const key = String(req.params.key || "").trim();
      if (!key || key.length > 128) return res.status(400).json({ valid: false, message: "Invalid invitation link." });
      // Group-chat links use GC-XXXXXX codes, not access-key records.
      if (/^GC-/i.test(key)) {
        const group = await storage.getGroupByCode(key.toUpperCase());
        if (!group) {
          console.warn("[group-invite] code lookup returned no group; check that the running server and group list use the same DATABASE_URL/database.");
          return res.status(404).json({ valid: false, message: "This group invitation was not found in the database used by this server. Restart the app and check its database connection." });
        }
        return res.json({ valid: true, type: "group", groupName: group.name });
      }
      const invite = await storage.getAccessKey(key);
      if (!invite) return res.status(404).json({ valid: false, message: "This invitation link is invalid or has been revoked." });
      if (invite.isUsed) return res.status(410).json({ valid: false, message: "This invitation has already been used or revoked and is no longer available." });
      return res.json({
        valid: true,
        type: invite.type,
        durationMinutes: invite.durationMinutes ?? null,
      });
    } catch (error) {
      console.error("Invite validation failed:", error);
      return res.status(500).json({ valid: false, message: "Could not verify this invitation right now." });
    }
  });

  app.post("/api/presence/heartbeat", requireAuth, async (req, res) => {
    const now = new Date();
    await db.update(users).set({ presenceStatus: "online", lastSeen: now }).where(eq(users.id, Number(req.session.userId!)));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, lastSeen: now });
  });

  app.get(api.auth.me.path, requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (user) {
      await db.update(users).set({ presenceStatus: "online", lastSeen: new Date() }).where(eq(users.id, user.id));
    }
    res.json(safeUser(user));
  });

  app.post(api.auth.logout.path, (req, res) => {
    const userId = req.session.userId;
    if (userId) {
      db.update(users).set({ presenceStatus: "offline", lastSeen: new Date() })
        .where(eq(users.id, userId)).catch(console.error);
    }
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  // === HUB POINTS WALLET ===
  const hubPointAwardCooldown = new Map<number, number>();
  app.get("/api/hub/wallet", requireAuth, async (req, res) => {
    const [account] = await db.select({ hubPoints: users.hubPoints, tokens: users.tokens })
      .from(users).where(eq(users.id, req.session.userId!)).limit(1);
    if (!account) return res.status(404).json({ message: "Account not found." });
    res.setHeader("Cache-Control", "no-store");
    res.json({ hubPoints: account.hubPoints, tokens: account.tokens });
  });

  app.post("/api/hub/points/earn", requireAuth, async (req, res) => {
    const requested = Number(req.body?.amount);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 25) {
      return res.status(400).json({ message: "A Hub Points reward must be between 1 and 25 points." });
    }
    const userId = Number(req.session.userId!);
    const now = Date.now();
    if (now - (hubPointAwardCooldown.get(userId) || 0) < 700) {
      return res.status(429).json({ message: "Please wait before claiming another Hub Points reward." });
    }
    const today = new Date().toISOString().slice(0, 10);
    const result = await db.transaction(async tx => {
      const [account] = await tx.select({
        hubPoints: users.hubPoints,
        hubPointsEarnedToday: users.hubPointsEarnedToday,
        hubPointsDay: users.hubPointsDay
      }).from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!account) return null;
      const earnedToday = account.hubPointsDay === today ? Number(account.hubPointsEarnedToday || 0) : 0;
      const awarded = Math.min(requested, Math.max(0, 200 - earnedToday));
      if (awarded <= 0) return { capped: true, hubPoints: account.hubPoints };
      const [updated] = await tx.update(users).set({
        hubPoints: Number(account.hubPoints || 0) + awarded,
        hubPointsEarnedToday: earnedToday + awarded,
        hubPointsDay: today
      }).where(eq(users.id, userId)).returning({ hubPoints: users.hubPoints });
      return { awarded, hubPoints: updated.hubPoints };
    });
    if (!result) return res.status(404).json({ message: "Account not found." });
    hubPointAwardCooldown.set(userId, now);
    if ("capped" in result) return res.status(429).json({ message: "You've reached today's 200 Hub Points earning limit.", hubPoints: result.hubPoints });
    res.json(result);
  });

  app.post("/api/hub/exchange", requireAuth, async (req, res) => {
    const points = Number(req.body?.points);
    if (!Number.isSafeInteger(points) || points < 5 || points % 5 !== 0) {
      return res.status(400).json({ message: "Exchange Hub Points in multiples of 5." });
    }
    const tokensAwarded = points / 5 * 2;
    const userId = Number(req.session.userId!);
    const result = await db.transaction(async tx => {
      const [account] = await tx.select({ hubPoints: users.hubPoints, tokens: users.tokens })
        .from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!account) return null;
      if (Number(account.hubPoints || 0) < points) return { insufficient: true, hubPoints: account.hubPoints, tokens: account.tokens };
      if (Number(account.tokens || 0) + tokensAwarded > 2147483647) return { overflow: true };
      const [updated] = await tx.update(users).set({
        hubPoints: Number(account.hubPoints) - points,
        tokens: Number(account.tokens || 0) + tokensAwarded
      }).where(eq(users.id, userId)).returning({ hubPoints: users.hubPoints, tokens: users.tokens });
      return { success: true, pointsSpent: points, tokensAwarded, hubPoints: updated.hubPoints, tokens: updated.tokens };
    });
    if (!result) return res.status(404).json({ message: "Account not found." });
    if ("insufficient" in result) return res.status(400).json({ message: "You don't have enough Hub Points to exchange that amount.", hubPoints: result.hubPoints, tokens: result.tokens });
    if ("overflow" in result) return res.status(400).json({ message: "Your token balance is already too high for this exchange." });
    res.json(result);
  });

  // === ADMIN ===
  // Account deletion is enforced here on the server, not just hidden in the UI.
  app.get("/api/admin/users", requireAuth, async (req, res) => {
    const actor = await storage.getUser(req.session.userId!);
    const actorRole = String(actor?.role || "").toLowerCase();
    if (!actor || !["owner", "super_owner"].includes(actorRole)) {
      return res.status(403).json({ message: "Only owners can manage accounts." });
    }
    const rows = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      lastSeen: users.lastSeen,
      presenceStatus: users.presenceStatus,
    }).from(users).orderBy(users.id);
    return res.json(rows.map(account => ({
      ...account,
      role: canonicalRole(account.role),
      canEditRole: actorRole === "super_owner" && account.id !== actor.id,
      canDelete: account.id !== actor.id && (
        actorRole === "super_owner" ||
        (actorRole === "owner" && !["super_owner", "owner", "admin", "trial-admin"].includes(String(account.role).toLowerCase()))
      ),
    })));
  });

  app.delete("/api/admin/users/:id", requireAuth, async (req, res) => {
    const actorId = Number(req.session.userId);
    const actor = await storage.getUser(actorId);
    const actorRole = String(actor?.role || "").toLowerCase();
    const targetId = Number(req.params.id);
    if (!actor || !["owner", "super_owner"].includes(actorRole)) {
      return res.status(403).json({ message: "Only owners can delete accounts." });
    }
    if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ message: "Invalid account ID." });
    if (targetId === actorId) return res.status(400).json({ message: "You cannot delete the account you are currently using." });
    const target = await storage.getUser(targetId);
    if (!target) return res.status(404).json({ message: "Account not found." });
    const targetRole = String(target.role).toLowerCase();
    if (actorRole === "owner" && ["super_owner", "owner", "admin", "trial-admin"].includes(targetRole)) {
      return res.status(403).json({ message: "Owners cannot delete admin or owner accounts." });
    }

    try {
      await db.transaction(async tx => {
        // Remove rows with restrictive user foreign keys before deleting the account.
      const ownedGroups = await tx.select({ id: groupChats.id }).from(groupChats).where(eq(groupChats.ownerId, targetId));
      const ownedGroupIds = ownedGroups.map(group => group.id);
      if (ownedGroupIds.length) {
        await tx.delete(messages).where(inArray(messages.groupId, ownedGroupIds));
        await tx.delete(groupChatMembers).where(inArray(groupChatMembers.groupId, ownedGroupIds));
        await tx.delete(groupChats).where(inArray(groupChats.id, ownedGroupIds));
      }
      await tx.delete(messages).where(or(eq(messages.senderId, targetId), eq(messages.recipientId, targetId)));
      await tx.execute(sql`DELETE FROM friend_requests WHERE requester_id = ${targetId} OR addressee_id = ${targetId}`);
      await tx.execute(sql`DELETE FROM blocks WHERE blocker_id = ${targetId} OR blocked_id = ${targetId}`);
      await tx.delete(groupChatMembers).where(eq(groupChatMembers.userId, targetId));
      await tx.execute(sql`DELETE FROM user_inventory WHERE user_id = ${targetId}`);
      await tx.delete(searchHistory).where(eq(searchHistory.userId, targetId));
      await tx.execute(sql`UPDATE access_keys SET created_by = NULL WHERE created_by = ${targetId}`);
      await tx.execute(sql`UPDATE access_requests SET created_user_id = NULL WHERE created_user_id = ${targetId}`);
      await tx.execute(sql`UPDATE custom_emojis SET created_by = NULL WHERE created_by = ${targetId}`);
      await tx.delete(moderationLogs).where(or(eq(moderationLogs.actorId, targetId), eq(moderationLogs.targetId, targetId)));
      await tx.execute(sql`DELETE FROM user_sessions WHERE sess->>'userId' = ${String(targetId)}`);
      await tx.insert(moderationLogs).values({
        actorId,
        targetId: null,
        action: "account-delete",
        reason: `Deleted account ${target.username} (#${target.id})`,
        metadata: { deletedUserId: target.id, deletedUsername: target.username, deletedRole: targetRole, actorRole },
      });
        await tx.delete(users).where(eq(users.id, targetId));
      });
    } catch (error) {
      console.error("[account-delete] Failed to delete account", { actorId, targetId, error });
      return res.status(500).json({ message: "Account deletion failed. No changes were saved; please try again." });
    }
    return res.json({ success: true, message: "Account deleted." });
  });

  app.post(api.admin.generateKey.path, requireOwner, async (req, res) => {
    const input = api.admin.generateKey.input.parse(req.body);
    // Generate a random key
    const key = `KEY-${randomBytes(4).toString('hex').toUpperCase()}`;

    const newKey = await storage.createAccessKey({
      key,
      type: input.type,
      durationMinutes: input.durationMinutes,
      createdBy: req.session.userId!
    });

    res.status(201).json(newKey);
  });

  app.get(api.admin.listKeys.path, requireOwner, async (req, res) => {
    // Join with users to see who used the key, also select isUsed and duration
    const keysWithUsers = await db.select({
      id: accessKeys.id,
      key: accessKeys.key,
      type: accessKeys.type,
      isUsed: accessKeys.isUsed,
      durationMinutes: accessKeys.durationMinutes,
      createdAt: accessKeys.createdAt,
      username: users.username,
    })
    .from(accessKeys)
    .leftJoin(users, eq(accessKeys.key, users.serialKey))
    .orderBy(desc(accessKeys.createdAt));

    res.json(keysWithUsers);
  });

  app.delete(api.admin.deleteKey.path, requireOwner, async (req, res) => {
    await storage.deleteAccessKey(Number(req.params.id));
    res.status(204).send();
  });

  // === HISTORY ===
  app.get(api.history.list.path, requireAuth, async (req, res) => {
    const history = await storage.getHistory(req.session.userId!);
    res.json(history);
  });

  app.post(api.history.create.path, requireAuth, async (req, res) => {
    const input = api.history.create.input.parse(req.body);
    const entry = await storage.createHistory({
      userId: req.session.userId!,
      url: input.url,
      query: input.query ?? undefined
    });
    res.status(201).json(entry);
  });

  app.delete(api.history.clear.path, requireAuth, async (req, res) => {
    await storage.clearHistory(req.session.userId!);
    res.status(204).send();
  });

  // === SERVER-AUTHORITATIVE ROLE + MODERATION COMMANDS ===
  const roleRank: Record<string, number> = {
    "super-owner": 110, owner: 100, admin: 90, "trial-admin": 80,
    "trial-moderator": 60, helper: 40, "trial-helper": 30, user: 0,
  };
  const canonicalRole = (role: string) => role.toLowerCase().replace(/_/g, "-");
  const actorRole = async (id: number) => {
    const actor = await storage.getUser(id);
    return actor ? canonicalRole(actor.role) : "user";
  };
  const canModerate = (actor: string, target: string) =>
    actor === "super-owner" || actor === "owner" || (roleRank[actor] ?? 0) > (roleRank[target] ?? 0);
  const moderationCommandNames = [
    "ban","unban","kick","mute","unmute","timeout","untimeout","warn","warnings","clearwarnings",
    "softban","tempban","permban","shadowban","unshadowban","jail","unjail","deafen","undeafen",
    "freeze","unfreeze","slowmode","slowmodeoff","lock","unlock","lockdown","unlockdown",
    "purge","purgeuser","purgebots","clear","slowchat","unslowchat","note","notes","clearnotes",
    "strike","strikes","clearstrikes","report","reports","resolve","role","promote","demote",
    "nickreset","restrict","unrestrict","unkick"
  ];
  const memberCommandNames = [
    "help","commands","poll","ai","me","shrug","roll","flip","avatar","profile","serverinfo","userinfo","ping",
    "whoami","rules","invite","coinflip","8ball","choose","quote","uptime"
  ];
  const parseDurationMs = (value: string) => {
    if (value === "null") return null;
    const match = value.match(/^([1-9]\d*)(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|mo|y)$/i);
    if (!match) return undefined;
    const n = Number(match[1]);
    const rawUnit = match[2].toLowerCase();
    const unit = rawUnit.startsWith("min") ? "m" : rawUnit.startsWith("hr") ? "h" : rawUnit.startsWith("day") ? "d" : rawUnit.startsWith("wk") ? "w" : rawUnit;
    return n * ({ m: 60000, h: 3600000, d: 86400000, w: 604800000, mo: 2592000000, y: 31536000000 } as Record<string, number>)[unit];
  };


  // Super-owner-only icon publishing. The GitHub token stays on the server.
  const managedIconNames = ["net-proxy","messages","history","updates","youtube-tools","block-blast","shop","galaxy-subscription","settings","moderation","admin-console","gs-gifts","profile","sign-out","gift","workspace","menu","close","nexus-icon","favicon"];
  const managedIconPath = (name: string) => name === "nexus-icon" ? "client/public/nexus-icon.png" : name === "favicon" ? "client/public/favicon.png" : `client/public/icons/${name}.png`;
  const requireSuperOwnerAccount = async (req: Request, res: any) => {
    const actor = await storage.getUser(Number(req.session.userId));
    if (!actor || String(actor.role).toLowerCase() !== "super_owner") {
      res.status(403).json({ message: "Super Owner access required." });
      return false;
    }
    return true;
  };
  const githubIconConfig = () => ({
    token: process.env.GITHUB_TOKEN || "",
    repository: process.env.GITHUB_REPOSITORY || "adamisfunnyz601-byte/fdsfdffdsd",
    branch: process.env.GITHUB_BRANCH || "feat/mobile-notifications-responsive-platforms",
  });
  app.get("/api/super-owner/icons", requireAuth, async (req, res) => {
    if (!await requireSuperOwnerAccount(req, res)) return;
    const { token, repository, branch } = githubIconConfig();
    if (!token) return res.status(503).json({ message: "GITHUB_TOKEN is not configured on the server." });
    try {
      const response = await fetch(`https://api.github.com/repos/${repository}/contents/client/public/icons?ref=${branch}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      });
      const data: any = response.ok ? await response.json() : [];
      const files = Array.isArray(data) ? data.filter((item:any) => item.type === "file" && item.name.endsWith(".png")) : [];
      const brandChecks = await Promise.all(["nexus-icon","favicon"].map(async name => {
        const check = await fetch(`https://api.github.com/repos/${repository}/contents/${managedIconPath(name)}?ref=${branch}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
        return [name, check.ok] as const;
      }));
      const brandSet = new Set(brandChecks.filter(([, exists]) => exists).map(([name]) => name));
      res.json({ icons: managedIconNames.map(name => ({ name, path: managedIconPath(name), url: name === "nexus-icon" ? "/nexus-icon.png" : name === "favicon" ? "/favicon.png" : `/icons/${name}.png`, customized: name === "nexus-icon" || name === "favicon" ? brandSet.has(name) : files.some((file:any) => file.name === `${name}.png`) })) });
    } catch { res.status(502).json({ message: "Could not read the icon directory from GitHub." }); }
  });
  app.put("/api/super-owner/icons/:name", requireAuth, async (req, res) => {
    if (!await requireSuperOwnerAccount(req, res)) return;
    const name = String(req.params.name || "");
    if (!managedIconNames.includes(name)) return res.status(400).json({ message: "Unknown icon." });
    const dataUrl = String(req.body?.dataUrl || "");
    const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ message: "Choose a valid PNG image." });
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return res.status(400).json({ message: "PNG must be between 1 byte and 2 MB." });
    const { token, repository, branch } = githubIconConfig();
    if (!token) return res.status(503).json({ message: "GITHUB_TOKEN is not configured on the server." });
    try {
      const path = managedIconPath(name);
      const existing = await fetch(`https://api.github.com/repos/${repository}/contents/${path}?ref=${branch}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      const old: any = existing.ok ? await existing.json() : null;
      const response = await fetch(`https://api.github.com/repos/${repository}/contents/${path}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ message: `Update NEXUS icon: ${name}`, content: bytes.toString("base64"), branch, ...(old?.sha ? { sha: old.sha } : {}) }),
      });
      const result: any = await response.json();
      if (!response.ok) {
        if (response.status === 403 && /resource not accessible|permission|write access/i.test(String(result.message || ""))) {
          return res.status(403).json({ message: "GitHub denied the upload. Update the Enzonic GITHUB_TOKEN: grant access to this repository and set Contents to Read and write, then save the secret and redeploy." });
        }
        return res.status(response.status).json({ message: result.message || "GitHub rejected the icon update." });
      }
      return res.json({ success: true, commit: result.commit?.html_url || null });
    } catch { return res.status(502).json({ message: "Could not publish this icon to GitHub." }); }
  });
  app.delete("/api/super-owner/icons/:name", requireAuth, async (req, res) => {
    if (!await requireSuperOwnerAccount(req, res)) return;
    const name = String(req.params.name || "");
    if (!managedIconNames.includes(name)) return res.status(400).json({ message: "Unknown icon." });
    const { token, repository, branch } = githubIconConfig();
    if (!token) return res.status(503).json({ message: "GITHUB_TOKEN is not configured on the server." });
    try {
      const path = `client/public/icons/${name}.png`;
      const current = await fetch(`https://api.github.com/repos/${repository}/contents/${path}?ref=${branch}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      if (current.status === 404) return res.json({ success: true, reverted: true });
      const file: any = await current.json();
      if (!current.ok || !file.sha) return res.status(502).json({ message: "Could not read the current icon revision." });
      const response = await fetch(`https://api.github.com/repos/${repository}/contents/${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Revert NEXUS icon: ${name}`, sha: file.sha, branch }),
      });
      const result: any = await response.json();
      if (!response.ok) return res.status(response.status).json({ message: result.message || "GitHub rejected the revert." });
      return res.json({ success: true, reverted: true });
    } catch { return res.status(502).json({ message: "Could not revert this icon." }); }
  });


  const superOwnerModerationFeatures = [{"id":"user_lookup","label":"User account lookup"},{"id":"user_activity","label":"Recent account activity"},{"id":"online_users","label":"Online users"},{"id":"offline_users","label":"Offline users"},{"id":"idle_users","label":"Idle users"},{"id":"dnd_users","label":"Do-not-disturb users"},{"id":"new_accounts","label":"Recently created accounts"},{"id":"expiring_accounts","label":"Accounts expiring soon"},{"id":"staff_roster","label":"Staff roster"},{"id":"role_distribution","label":"Role distribution"},{"id":"friendship_health","label":"Friendship totals"},{"id":"pending_friend_requests","label":"Pending friend requests"},{"id":"blocked_accounts","label":"Block relationship audit"},{"id":"message_volume","label":"Message volume"},{"id":"deleted_messages","label":"Deleted message audit"},{"id":"recent_messages","label":"Recent message audit"},{"id":"moderation_history","label":"Moderation history"},{"id":"recent_warnings","label":"Recent warnings"},{"id":"recent_role_changes","label":"Recent role changes"},{"id":"subscription_audit","label":"Subscription audit"},{"id":"profile_audit","label":"Profile completeness audit"},{"id":"avatar_audit","label":"Avatar audit"},{"id":"banner_audit","label":"Banner audit"},{"id":"privacy_audit","label":"Privacy settings audit"},{"id":"notification_audit","label":"Notification preferences audit"},{"id":"emote_preferences","label":"Emote preferences audit"},{"id":"call_privacy_audit","label":"Call privacy audit"},{"id":"dm_privacy_audit","label":"DM privacy audit"},{"id":"inactive_accounts","label":"Inactive accounts"},{"id":"long_inactive_accounts","label":"Long inactive accounts"},{"id":"high_coin_accounts","label":"High coin balances"},{"id":"high_point_accounts","label":"High hub point balances"},{"id":"custom_tags_audit","label":"Custom profile tags audit"},{"id":"nickname_audit","label":"Nickname audit"},{"id":"bio_audit","label":"Profile bio audit"},{"id":"recent_signups","label":"Signup trend"},{"id":"account_expiry_audit","label":"Account expiry audit"},{"id":"friendless_accounts","label":"Accounts without friends"},{"id":"blocked_by_many","label":"Frequently blocked accounts"},{"id":"message_spam_audit","label":"High message volume accounts"},{"id":"moderator_activity","label":"Moderator activity"},{"id":"reset_presence","label":"Force target offline"},{"id":"reset_privacy","label":"Reset target privacy settings"},{"id":"reset_profile_tags","label":"Clear target profile tags"},{"id":"reset_profile_cosmetics","label":"Reset target profile cosmetics"},{"id":"clear_bio","label":"Clear target bio"},{"id":"clear_nickname","label":"Clear target nickname"},{"id":"remove_custom_avatar","label":"Remove target avatar"},{"id":"remove_custom_banner","label":"Remove target banner"},{"id":"reset_notifications","label":"Reset target notification settings"}];
  app.get("/api/super-owner/moderation/features", requireAuth, async (req, res) => {
    const actor = await storage.getUser(Number(req.session.userId));
    if (!actor || canonicalRole(actor.role) !== "super-owner") return res.status(403).json({ message: "Super Owner access required." });
    return res.json({ features: superOwnerModerationFeatures });
  });
  app.post("/api/super-owner/moderation/features/:action", requireAuth, async (req, res) => {
    const actorId = Number(req.session.userId);
    const actor = await storage.getUser(actorId);
    if (!actor || canonicalRole(actor.role) !== "super-owner") return res.status(403).json({ message: "Super Owner access required." });
    const action = String(req.params.action);
    if (!superOwnerModerationFeatures.some(feature => feature.id === action)) return res.status(404).json({ message: "Unknown moderation feature." });
    const targetId = Number(req.body?.targetId);
    const target = Number.isSafeInteger(targetId) && targetId > 0 ? await storage.getUser(targetId) : null;
    const audit = async (result: unknown) => {
      await db.insert(moderationLogs).values({ actorId, targetId: target?.id ?? null, action: "super-owner:" + action, reason: String(req.body?.reason || "Super Owner moderation console").slice(0, 300), metadata: { result } });
      return res.json({ success: true, action, result });
    };
    if (["reset_presence","reset_privacy","reset_profile_tags","reset_profile_cosmetics","clear_bio","clear_nickname","remove_custom_avatar","remove_custom_banner","reset_notifications"].includes(action) && !target) return res.status(400).json({ message: "Select a valid target account first." });
    if (action === "reset_presence") { await db.update(users).set({ presenceStatus: "offline", lastSeen: new Date(0) }).where(eq(users.id,target!.id)); return audit({ username:target!.username, presenceStatus:"offline" }); }
    if (action === "reset_privacy") { await db.update(users).set({ muteEmotes:false, muteNonFriendCalls:false, dmFriendsOnly:false }).where(eq(users.id,target!.id)); return audit({ username:target!.username, reset:"privacy settings" }); }
    if (action === "reset_profile_tags") { await db.update(users).set({ tagSymbol:null, tagText:null, tagColor:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, reset:"profile tags" }); }
    if (action === "reset_profile_cosmetics") { await db.update(users).set({ decorationId:null, nameStyleId:null, profileDecoration:null, profileGradient:null, usernameFont:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, reset:"profile cosmetics" }); }
    if (action === "clear_bio") { await db.update(users).set({ bio:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, bio:"cleared" }); }
    if (action === "clear_nickname") { await db.update(users).set({ nickname:null, displayName:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, nickname:"cleared" }); }
    if (action === "remove_custom_avatar") { await db.update(users).set({ avatarUrl:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, avatar:"removed" }); }
    if (action === "remove_custom_banner") { await db.update(users).set({ bannerUrl:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, banner:"removed" }); }
    if (action === "reset_notifications") { await db.update(users).set({ muteNotifications:false, ringtoneUrl:null }).where(eq(users.id,target!.id)); return audit({ username:target!.username, reset:"notification settings" }); }
    const allUsers = await storage.getAllUsers();
    const userRows = allUsers as any[];
    const logs = await db.select().from(moderationLogs).orderBy(desc(moderationLogs.createdAt)).limit(500);
    const recentMessages = await db.select().from(messages).orderBy(desc(messages.createdAt)).limit(500);
    const friendRows = await db.select().from(friendRequests).where(eq(friendRequests.status,"accepted")).limit(10000);
    const blockRows = await db.select().from(blocks).limit(10000);
    let result: any;
    switch(action) {
      case "user_lookup": result = target ? safeUser(target) : userRows.slice(0,100).map(safeUser); break;
      case "user_activity": result = target ? logs.filter((x:any)=>x.targetId===target.id).slice(0,50) : logs.slice(0,50); break;
      case "online_users": case "offline_users": case "idle_users": case "dnd_users": result=userRows.filter((u:any)=>u.presenceStatus===action.replace("_users","")).map((u:any)=>({id:u.id,username:u.username,lastSeen:u.lastSeen})); break;
      case "new_accounts": case "recent_signups": result=userRows.filter((u:any)=>Date.now()-new Date(u.createdAt||0).getTime()<7*86400000).map((u:any)=>({id:u.id,username:u.username,createdAt:u.createdAt})); break;
      case "expiring_accounts": case "account_expiry_audit": result=userRows.filter((u:any)=>u.expiresAt).map((u:any)=>({id:u.id,username:u.username,expiresAt:u.expiresAt})); break;
      case "staff_roster": result=userRows.filter((u:any)=>canonicalRole(u.role)!=="user").map((u:any)=>({id:u.id,username:u.username,role:u.role})); break;
      case "role_distribution": result=Object.entries(userRows.reduce((a:any,u:any)=>(a[u.role]=(a[u.role]||0)+1,a),{})); break;
      case "friendship_health": result={accepted:friendRows.length,pending:(await db.select().from(friendRequests).where(eq(friendRequests.status,"pending"))).length}; break;
      case "pending_friend_requests": result=await db.select().from(friendRequests).where(eq(friendRequests.status,"pending")).limit(500); break;
      case "blocked_accounts": result=blockRows.slice(0,500); break;
      case "message_volume": result={recent500:recentMessages.length}; break;
      case "deleted_messages": result=recentMessages.filter((m:any)=>m.isDeleted).slice(0,100); break;
      case "recent_messages": result=recentMessages.slice(0,100).map((m:any)=>({id:m.id,senderId:m.senderId,recipientId:m.recipientId,groupId:m.groupId,createdAt:m.createdAt,isDeleted:m.isDeleted})); break;
      case "moderation_history": result=logs.slice(0,200); break;
      case "recent_warnings": result=logs.filter((l:any)=>/warn/i.test(l.action)).slice(0,100); break;
      case "recent_role_changes": result=logs.filter((l:any)=>/role-change/i.test(l.action)).slice(0,100); break;
      case "subscription_audit": result=userRows.filter((u:any)=>u.subscriptionTier&&u.subscriptionTier!=="none").map((u:any)=>({id:u.id,username:u.username,tier:u.subscriptionTier,until:u.dihhroUntil})); break;
      case "profile_audit": result=userRows.map((u:any)=>({id:u.id,username:u.username,hasAvatar:!!u.avatarUrl,hasBanner:!!u.bannerUrl,hasBio:!!u.bio})); break;
      case "avatar_audit": result=userRows.filter((u:any)=>!!u.avatarUrl).map((u:any)=>({id:u.id,username:u.username})); break;
      case "banner_audit": result=userRows.filter((u:any)=>!!u.bannerUrl).map((u:any)=>({id:u.id,username:u.username})); break;
      case "privacy_audit": case "call_privacy_audit": case "dm_privacy_audit": case "emote_preferences": result=userRows.map((u:any)=>({id:u.id,username:u.username,muteEmotes:u.muteEmotes,muteNonFriendCalls:u.muteNonFriendCalls,dmFriendsOnly:u.dmFriendsOnly})); break;
      case "notification_audit": result=userRows.map((u:any)=>({id:u.id,username:u.username,muteNotifications:u.muteNotifications})); break;
      case "inactive_accounts": case "long_inactive_accounts": result=userRows.filter((u:any)=>!u.lastSeen||Date.now()-new Date(u.lastSeen).getTime()>(action==="inactive_accounts"?7:30)*86400000).map((u:any)=>({id:u.id,username:u.username,lastSeen:u.lastSeen})); break;
      case "high_coin_accounts": result=userRows.filter((u:any)=>Number(u.coins)>1000).map((u:any)=>({id:u.id,username:u.username,coins:u.coins})); break;
      case "high_point_accounts": result=userRows.filter((u:any)=>Number(u.hubPoints)>1000).map((u:any)=>({id:u.id,username:u.username,hubPoints:u.hubPoints})); break;
      case "custom_tags_audit": result=userRows.filter((u:any)=>u.tagText||u.tagSymbol).map((u:any)=>({id:u.id,username:u.username,tagText:u.tagText,tagSymbol:u.tagSymbol})); break;
      case "nickname_audit": result=userRows.filter((u:any)=>u.nickname||u.displayName).map((u:any)=>({id:u.id,username:u.username,nickname:u.nickname,displayName:u.displayName})); break;
      case "bio_audit": result=userRows.filter((u:any)=>u.bio).map((u:any)=>({id:u.id,username:u.username,bio:u.bio})); break;
      case "friendless_accounts": result=userRows.filter((u:any)=>!friendRows.some((f:any)=>f.requesterId===u.id||f.addresseeId===u.id)).map((u:any)=>({id:u.id,username:u.username})); break;
      case "blocked_by_many": result=Object.entries(blockRows.reduce((a:any,b:any)=>(a[b.blockedId]=(a[b.blockedId]||0)+1,a),{})).filter(([,n]:any)=>n>=3); break;
      case "message_spam_audit": result=Object.entries(recentMessages.reduce((a:any,m:any)=>(a[m.senderId]=(a[m.senderId]||0)+1,a),{})).filter(([,n]:any)=>n>=10); break;
      case "moderator_activity": result=Object.entries(logs.reduce((a:any,l:any)=>(a[l.actorId]=(a[l.actorId]||0)+1,a),{})); break;
      default: result={message:"Audit complete."};
    }
    return audit(result);
  });

  app.get("/api/moderation/users", requireAuth, async (req, res) => {
    const actor = await storage.getUser(req.session.userId!);
    const allowed = ["super-owner","owner","admin","trial-admin","moderator","trial-moderator","helper","trial-helper"];
    if (!actor || !allowed.includes(canonicalRole(actor.role))) return res.status(403).json({ message: "Staff access required." });
    return res.json((await storage.getAllUsers()).map(safeUser));
  });

  app.get("/api/chat/commands", requireAuth, (_req, res) => {
    res.json({ moderation: moderationCommandNames, member: memberCommandNames });
  });

  app.patch("/api/admin/users/:id/role", requireAuth, async (req, res) => {
    const actorId = req.session.userId!;
    const actor = await storage.getUser(actorId);
    const targetId = Number(req.params.id);
    const target = await storage.getUser(targetId);
    const requestedRole = typeof req.body?.role === "string" ? canonicalRole(req.body.role) : "";
    if (!actor || !target) return res.status(404).json({ message: "User not found" });
    const aRole = canonicalRole(actor.role), tRole = canonicalRole(target.role);
    const isSuperOwner = aRole === "super-owner";
    const allowedRoles = ["super-owner","owner","admin","trial-admin","moderator","trial-moderator","helper","trial-helper","user"];
    if (!allowedRoles.includes(requestedRole)) return res.status(400).json({ message: "Invalid role" });
    if (!isSuperOwner) {
      if (!Object.prototype.hasOwnProperty.call(roleRank, aRole) || (roleRank[aRole] ?? 0) < roleRank["trial-helper"]) return res.status(403).json({ message: "Staff access is required to assign roles." });
      if (targetId === actorId) return res.status(403).json({ message: "You cannot change your own role." });
      if (tRole === "super-owner" || (tRole === "owner" && aRole !== "super-owner")) return res.status(403).json({ message: "That account is protected by the ownership hierarchy." });
      if (requestedRole === "super-owner") return res.status(403).json({ message: "Only a Super Owner can grant the Super Owner role." });
      if (requestedRole === "owner" && aRole !== "owner") return res.status(403).json({ message: "Only an owner can grant the owner role." });
      if (aRole !== "owner" && (roleRank[tRole] ?? 0) >= (roleRank[aRole] ?? 0)) return res.status(403).json({ message: "You can only change members with a lower role than yours." });
      if (aRole !== "owner" && (roleRank[requestedRole] ?? 0) >= (roleRank[aRole] ?? 0)) return res.status(403).json({ message: "You can only assign roles below your own." });
    } else if (targetId === actorId) return res.status(403).json({ message: "You cannot change your own role from this session." });
    await db.update(users).set({ role: requestedRole.replace(/-/g, "_") }).where(eq(users.id, targetId));
    await db.insert(moderationLogs).values({ actorId, targetId, action: "role-change", reason: "Role changed from " + target.role + " to " + requestedRole, metadata: { from: tRole, to: requestedRole, superOwnerOverride: isSuperOwner } });
    return res.json({ success: true, userId: targetId, role: requestedRole });
  });

  app.post("/api/chat/command", requireAuth, async (req, res) => {
    const actorId = req.session.userId!;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text.startsWith("/") || text.length > 500) return res.status(400).json({ message: "Invalid command." });
    const [rawName, ...args] = text.slice(1).split(/\s+/);
    const name = (rawName || "").toLowerCase();
    const actor = await storage.getUser(actorId);
    if (!actor) return res.status(401).json({ message: "Session user not found." });
    const aRole = canonicalRole(actor.role);
    const isModCommand = moderationCommandNames.includes(name);
    const helperCommands = ["warn","warnings","note","notes","report","reports"];
    const trialHelperCommands = ["note","report"];
    const staffAllowed = (roleRank[aRole] ?? 0) >= roleRank["trial-moderator"]
      || (aRole === "helper" && helperCommands.includes(name))
      || (aRole === "trial-helper" && trialHelperCommands.includes(name));
    if (isModCommand && !staffAllowed) return res.status(403).json({ message: "Your staff role does not have permission to use this command." });
    if (!isModCommand && !memberCommandNames.includes(name)) return res.status(400).json({ message: "Unknown command. Use /help." });

    if (!isModCommand) {
      if (name === "help") return res.json({ message: `Member commands: /${memberCommandNames.join(", /")}. Moderation commands require staff permissions.` });
      if (name === "ping") return res.json({ message: "Pong! API is responding." });
      if (name === "whoami") return res.json({ message: `You are ${actor.username} (${aRole}).` });
      if (name === "roll" || name === "coinflip" || name === "flip") {
        const sides = name === "roll" ? Math.min(100, Math.max(2, Number((args[0] || "d6").replace(/^d/i, "")) || 6)) : 2;
        return res.json({ message: name === "roll" ? `You rolled ${1 + Math.floor(Math.random()*sides)} (d${sides}).` : Math.random() < .5 ? "Heads!" : "Tails!" });
      }
      if (name === "me") return res.json({ message: args.join(" ").slice(0, 200) ? `* ${actor.username} ${args.join(" ").slice(0,200)}` : "Usage: /me <action>" });
      if (name === "shrug") return res.json({ message: "¯\\_(ツ)_/¯" });
      if (name === "8ball") return res.json({ message: ["Absolutely.","Probably.","Ask again later.","Unlikely.","No."][Math.floor(Math.random()*5)] });
      if (name === "choose") return res.json({ message: args.join(" ").split("|").map((x:string)=>x.trim()).filter(Boolean).sort(()=>Math.random()-.5)[0] || "Usage: /choose option A | option B" });
      if (name === "rules") return res.json({ message: "Be respectful, do not harass others, and follow the community rules." });
      if (name === "serverinfo") return res.json({ message: "Secure Web Gateway community chat." });
      if (name === "userinfo" || name === "profile" || name === "avatar") {
        const target = await storage.getUser(Number(args[0])) || (args[0] ? await storage.getUserBySerial(args[0]) : actor);
        return res.json({ message: target ? `${target.username} · ${canonicalRole(target.role)}` : "User not found." });
      }
      return res.json({ message: `/${name} is recognised. This command does not change account data.` });
    }

    const needsTarget = !["slowmode","slowmodeoff","lock","unlock","lockdown","unlockdown","purge","clear","slowchat","unslowchat","reports","uptime"].includes(name);
    let targetId = Number(req.body?.targetUserId || args[0]?.replace(/^@/,""));
    let target = Number.isInteger(targetId) && targetId > 0 ? await storage.getUser(targetId) : undefined;
    if (!target && args[0]) {
      const all = await storage.getAllUsers();
      target = all.find((u:any) => u.username.toLowerCase() === args[0].replace(/^@/,"").toLowerCase());
      targetId = target?.id ?? 0;
    }
    if (needsTarget && (!target || !targetId)) return res.status(400).json({ message: "Specify a valid target username or user ID." });
    if (target) {
      const tRole = canonicalRole(target.role);
      if (targetId === actorId) return res.status(400).json({ message: "You cannot moderate yourself." });
      if (tRole === "super-owner" || (tRole === "owner" && aRole !== "super-owner") || !canModerate(aRole,tRole)) return res.status(403).json({ message: "That member is protected by the role hierarchy." });
    }
    const durationToken = String(req.body?.duration || args[1] || "");
    const durationMs = ["ban","tempban","mute","timeout","jail","restrict","shadowban","softban"].includes(name) ? parseDurationMs(durationToken) : null;
    if (["ban","tempban","mute","timeout","jail","restrict","shadowban","softban"].includes(name) && durationMs === undefined) return res.status(400).json({ message: "Provide a duration such as 10m, 2h, 3d, 1w, 1mo, 1y or null." });
    if (name === "role" || name === "promote" || name === "demote") {
      if (!target) return res.status(400).json({ message: "Specify a target username." });
      const desired = canonicalRole(String(args[1] || req.body?.role || ""));
      if (!["admin","trial-admin","moderator","trial-moderator","helper","trial-helper","user"].includes(desired)) return res.status(400).json({ message: "Usage: /role @user admin|trial-admin|moderator|trial-moderator|helper|trial-helper|user" });
      if (aRole !== "owner" && (roleRank[desired] ?? 0) >= (roleRank[aRole] ?? 0)) return res.status(403).json({ message: "You cannot assign a role equal to or above your own." });
      await db.update(users).set({ role: desired }).where(eq(users.id, target.id));
      await db.insert(moderationLogs).values({ actorId, targetId: target.id, action: "role-change", reason: `Role set to ${desired}`, metadata: { to: desired } });
      return res.json({ message: `${target.username} is now ${desired}.` });
    }
    const reason = String(req.body?.reason || args.slice(2).join(" ") || "").slice(0,300);
    const action = name;
    await db.insert(moderationLogs).values({
      actorId, targetId: targetId || null, action, reason: reason || null,
      duration: durationToken || null,
      expiresAt: durationMs ? new Date(Date.now()+durationMs) : null,
      metadata: { command: name, actorRole: aRole },
    });
    if (name === "unkick") return res.json({ message: "Kicks are immediate, not timed restrictions. The member can rejoin with a valid invite; there is no kick ban to reverse." });
    if (name === "purge" || name === "clear") {
      const count = Math.min(100, Math.max(1, Number(args[0]) || 10));
      const deleted = await db.delete(messages).where(sql`${messages.id} IN (SELECT id FROM messages WHERE group_id IS NULL AND recipient_id IS NULL ORDER BY created_at DESC LIMIT ${count})`).returning({id:messages.id});
      return res.json({ message: `Removed ${deleted.length} recent public messages. Audit entry saved.` });
    }
    if (name === "warnings" || name === "strikes" || name === "notes" || name === "reports") {
      const rows = await db.select().from(moderationLogs).where(targetId ? eq(moderationLogs.targetId,targetId) : eq(moderationLogs.actorId,actorId)).orderBy(desc(moderationLogs.createdAt)).limit(20);
      return res.json({ message: rows.length ? rows.map(row=>`#${row.id} ${row.action}: ${row.reason || "No reason"}`).join(" · ") : "No records found." });
    }
    res.json({ message: `/${name} recorded for ${target?.username || "the current chat"}.` });
  });

  // Block Blast monthly leaderboard.
  const monthKeyFor = (d = new Date()) => d.getUTCFullYear() + "-" + String(d.getUTCMonth()+1).padStart(2,"0");
  app.get("/api/blockblast/leaderboard", requireAuth, async (req,res) => {
    await awardPreviousMonthChampion();
    const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : monthKeyFor();
    const rows = await db.select({userId:blockBlastScores.userId,score:blockBlastScores.score,username:users.username,displayName:users.displayName}).from(blockBlastScores).innerJoin(users,eq(users.id,blockBlastScores.userId)).where(eq(blockBlastScores.monthKey,month)).orderBy(desc(blockBlastScores.score)).limit(100);
    const best = new Map<number,typeof rows[number]>(); rows.forEach(row=>{const old=best.get(row.userId);if(!old||row.score>old.score)best.set(row.userId,row);});
    res.json({month,entries:Array.from(best.values()).sort((a,b)=>b.score-a.score).map((row,index)=>({...row,rank:index+1}))});
  });
  // When a new month starts, award the previous month's Block Blast champion once.
  const awardPreviousMonthChampion = async () => {
    const current = new Date();
    const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    const previousMonth = monthKeyFor(previous);
    const [champion] = await db.select({ userId: blockBlastScores.userId, score: blockBlastScores.score })
      .from(blockBlastScores).where(eq(blockBlastScores.monthKey, previousMonth))
      .orderBy(desc(blockBlastScores.score), desc(blockBlastScores.createdAt)).limit(1);
    if (!champion) return;
    const expiry = new Date();
    expiry.setUTCMonth(expiry.getUTCMonth() + 1);
    const inserted = await db.insert(dihhroAwards).values({
      userId: champion.userId, monthKey: previousMonth, score: champion.score, expiresAt: expiry,
    }).onConflictDoNothing().returning({ id: dihhroAwards.id });
    if (!inserted.length) return;
    const [winner] = await db.select({ coins: users.coins, dihhroUntil: users.dihhroUntil }).from(users).where(eq(users.id, champion.userId)).limit(1);
    const balance = Math.max(0, Number(winner?.coins || 0));
    const now = new Date();
    const oldExpiry = winner?.dihhroUntil && new Date(winner.dihhroUntil) > now ? new Date(winner.dihhroUntil) : now;
    const until = new Date(oldExpiry); until.setUTCMonth(until.getUTCMonth() + 1);
    await db.update(users).set({ coins: String(Math.min(2147483647, balance + 500)), subscriptionTier: "silver", dihhroUntil: until }).where(eq(users.id, champion.userId));
  };

  const ensureBlockBlastChatRoom = async (userId:number) => {
    const inviteCode = "blockblast-public-room";
    let [room] = await db.select().from(groupChats).where(eq(groupChats.inviteCode,inviteCode)).limit(1);
    if (!room) {
      try {
        [room] = await db.insert(groupChats).values({name:"Block Blast Live Chat",inviteCode,ownerId:userId}).returning();
      } catch {
        [room] = await db.select().from(groupChats).where(eq(groupChats.inviteCode,inviteCode)).limit(1);
      }
    }
    if (!room) throw new Error("Could not initialise Block Blast chat");
    const [membership] = await db.select({id:groupChatMembers.id}).from(groupChatMembers).where(and(eq(groupChatMembers.groupId,room.id),eq(groupChatMembers.userId,userId))).limit(1);
    if (!membership) await db.insert(groupChatMembers).values({groupId:room.id,userId}).onConflictDoNothing();
    return room.id;
  };

  app.get("/api/blockblast/chat", requireAuth, async (req,res) => {
    const groupId = await ensureBlockBlastChatRoom(req.session.userId!);
    const rows = await storage.getMessages(req.session.userId!,undefined,groupId);
    res.setHeader("Cache-Control","no-store");
    res.json(rows.slice(-100));
  });

  app.post("/api/blockblast/chat", requireAuth, async (req,res) => {
    const content = typeof req.body?.content === "string" ? req.body.content.trim().slice(0,300) : "";
    if (!content) return res.status(400).json({message:"Enter a message first."});
    const [activeMute] = await db.select().from(moderationLogs).where(and(eq(moderationLogs.targetId,req.session.userId!),sql`${moderationLogs.action} IN ('mute','timeout','jail','restrict')`)).orderBy(desc(moderationLogs.createdAt)).limit(1);
    if (activeMute && (!activeMute.expiresAt || activeMute.expiresAt > new Date())) return res.status(403).json({message:"You are currently muted or restricted."});
    const groupId = await ensureBlockBlastChatRoom(req.session.userId!);
    const created = await storage.createMessage({senderId:req.session.userId!,groupId,content});
    const [row] = await db.select({id:messages.id,content:messages.content,createdAt:messages.createdAt,senderId:messages.senderId,senderName:users.username,senderDisplayName:users.displayName}).from(messages).innerJoin(users,eq(messages.senderId,users.id)).where(eq(messages.id,created.id)).limit(1);
    const [usage] = await db.select({bytes:sql<number>`COALESCE(SUM(octet_length(${messages.content}) + COALESCE(octet_length(${messages.mediaUrl}),0)),0)`}).from(messages).where(eq(messages.groupId,groupId));
    if (Number(usage?.bytes||0) > 1024*1024*1024) {
      await db.execute(sql`WITH ranked AS (
        SELECT id, SUM(octet_length(content) + COALESCE(octet_length(media_url),0)) OVER (ORDER BY created_at ASC, id ASC) AS total_bytes
        FROM messages WHERE group_id = ${groupId}
      ), purge AS (SELECT id FROM ranked WHERE total_bytes <= 500*1024*1024)
      DELETE FROM messages WHERE id IN (SELECT id FROM purge)`);
    }
    res.status(201).json(row);
  });

  app.get("/api/blockblast/history", requireAuth, async (req,res) => { const rows=await db.select().from(blockBlastScores).where(eq(blockBlastScores.userId,req.session.userId!)).orderBy(desc(blockBlastScores.createdAt)).limit(30); res.json(rows); });
  app.post("/api/blockblast/scores", requireAuth, async (req,res) => {
    const score=Number(req.body?.score); if(!Number.isSafeInteger(score)||score<0||score>1000000) return res.status(400).json({message:"Invalid score."});
    const userId=req.session.userId!; const [recent]=await db.select().from(blockBlastScores).where(eq(blockBlastScores.userId,userId)).orderBy(desc(blockBlastScores.createdAt)).limit(1);
    if(recent?.createdAt && Date.now()-recent.createdAt.getTime()<3000) return res.status(429).json({message:"Please wait before submitting another run."});
    await db.insert(blockBlastScores).values({userId,score,monthKey:monthKeyFor()}); res.status(201).json({success:true,score,month:monthKeyFor()});
  });
  // Download a selected GIPHY GIF and persist its bytes as a real attachment file.
  // Only the opaque file reference is written to the messages table; GIF bytes stay on disk.
  app.post("/api/chat/gifs/prepare", requireAuth, async (req, res) => {
    try {
      const source = typeof req.body?.url === "string" ? req.body.url : "";
      let parsed: URL;
      try { parsed = new URL(source); } catch { return res.status(400).json({ message: "Invalid GIF source." }); }
      const isGiphyHost = (host: string) => host === "giphy.com" || host.endsWith(".giphy.com");
      if (parsed.protocol !== "https:" || !isGiphyHost(parsed.hostname.toLowerCase())) {
        return res.status(400).json({ message: "GIFs must come directly from GIPHY." });
      }
      const upstream = await fetch(parsed.toString(), { headers: { Accept: "image/gif" }, signal: AbortSignal.timeout(15000) });
      if (!upstream.ok || !isGiphyHost(new URL(upstream.url).hostname.toLowerCase())) {
        return res.status(502).json({ message: "Could not download this GIF." });
      }
      const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const declaredSize = Number(upstream.headers.get("content-length") || 0);
      if (contentType !== "image/gif") return res.status(415).json({ message: "The selected item is not a GIF image." });
      if (declaredSize > 8 * 1024 * 1024) return res.status(413).json({ message: "GIFs must be 8 MB or smaller." });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("ascii", 0, 6) !== "GIF87a" && bytes.toString("ascii", 0, 6) !== "GIF89a") {
        return res.status(415).json({ message: "The downloaded file is not a valid GIF or is too large." });
      }
      const filename = randomBytes(20).toString("hex") + ".gif";
      await pool.query(
        "INSERT INTO nexus_chat_gif_attachments (filename, content) VALUES ($1, $2)",
        [filename, bytes],
      );
      return res.status(201).json({ mediaUrl: "file:" + filename, mediaType: "image" });
    } catch (error: any) {
      console.error("[chat-gif] Save failed:", error?.message || error);
      return res.status(502).json({ message: "Could not save this GIF as a chat attachment." });
    }
  });

  // === CHAT ===
  app.get(api.chat.list.path, requireAuth, async (req, res) => {
    const recipientId = req.query.recipientId ? Number(req.query.recipientId) : undefined;
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
    if (recipientId !== undefined && (!Number.isInteger(recipientId) || recipientId <= 0)) {
      return res.status(400).json({ message: "Invalid recipient" });
    }
    if (groupId !== undefined && (!Number.isInteger(groupId) || groupId <= 0)) {
      return res.status(400).json({ message: "Invalid group" });
    }
    const messages = await storage.getMessages(req.session.userId!, recipientId, groupId);
    res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.json(messages);
  });

  app.post(api.chat.send.path, requireAuth, async (req, res) => {
    const input = api.chat.send.input.parse(req.body);
    if (input.mediaUrl) {
      const mediaUrl = input.mediaUrl;
      const dataMatch = /^data:(image\/(?:png|jpeg|gif|webp|avif)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)(?:;[a-z0-9._=-]+)*;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(mediaUrl);
      const isHttpUrl = /^https:\/\//i.test(mediaUrl) && mediaUrl.length <= 2048;
      const isSavedGif = /^file:[a-f0-9]{40}\.gif$/i.test(mediaUrl);
      if (!dataMatch && !isHttpUrl && !isSavedGif) return res.status(400).json({ message: "Unsupported attachment format." });
      if (dataMatch && Math.floor(dataMatch[2].length * 3 / 4) > 8 * 1024 * 1024) {
        return res.status(413).json({ message: "Attachments must be 8 MB or smaller." });
      }
      const actualKind = dataMatch?.[1].split("/")[0];
      if (actualKind && input.mediaType && !(input.mediaType === actualKind || (actualKind === "audio" && input.mediaType === "audio/namaf1"))) {
        return res.status(400).json({ message: "Attachment type does not match its audio, image or video data." });
      }
    }
    const chatEmoteMatch = typeof input.content === "string" ? input.content.match(/^\[CHAT_EMOTE:(\d+)\]$/) : null;
    if (typeof input.content === "string" && input.content.startsWith("[CHAT_EMOTE:") && !chatEmoteMatch) return res.status(400).json({ message: "Invalid chat emote." });
    if (chatEmoteMatch) {
      const emoteId = Number(chatEmoteMatch[1]);
      const inventory = await storage.getUserInventory(Number(req.session.userId!));
      if (!Number.isSafeInteger(emoteId) || !inventory.some((item:any) => Number(item.id) === emoteId && item.type === "emote")) return res.status(403).json({ message: "You must own that emote before sending it in chat." });
    }
    const [activeMute] = await db.select().from(moderationLogs)
      .where(and(eq(moderationLogs.targetId, req.session.userId!), sql`${moderationLogs.action} IN ('mute','timeout','jail','restrict','unmute','untimeout','unjail','unrestrict')`))
      .orderBy(desc(moderationLogs.createdAt)).limit(1);
    if (activeMute && !["unmute","untimeout","unjail","unrestrict"].includes(activeMute.action) && (!activeMute.expiresAt || activeMute.expiresAt > new Date())) {
      return res.status(403).json({ message: "You are currently muted or restricted by moderation." });
    }
    if (input.recipientId && input.groupId) {
      return res.status(400).json({ message: "Choose a DM or a channel, not both" });
    }
    if (input.recipientId) {
      if (input.recipientId === req.session.userId) {
        return res.status(400).json({ message: "You cannot DM yourself" });
      }
      if (await blockedEitherWay(req.session.userId!, input.recipientId)) {
        return res.status(403).json({ message: "Messaging is unavailable for this user" });
      }
      const recipientAccount = await storage.getUser(input.recipientId);
      if (recipientAccount?.dmFriendsOnly && !(await areAcceptedFriends(Number(req.session.userId!), input.recipientId))) {
        return res.status(403).json({ message: "This user only accepts direct messages from friends." });
      }
    }
    if (input.groupId) {
      const [membership] = await db.select({ id: groupChatMembers.id })
        .from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupId, input.groupId), eq(groupChatMembers.userId, req.session.userId!)))
        .limit(1);
      if (!membership) return res.status(403).json({ message: "You are not a member of this channel" });
    }
    const requestedReplyToId = (req.body as any).replyToId == null ? null : Number((req.body as any).replyToId);
    let replyContext: { content: string; senderName: string } | null = null;
    let replyToId: number | null = null;
    if (requestedReplyToId !== null) {
      if (!Number.isInteger(requestedReplyToId) || requestedReplyToId <= 0) return res.status(400).json({ message: "Invalid reply target." });
      const replyConditions = input.groupId
        ? and(eq(messages.id, requestedReplyToId), eq(messages.groupId, input.groupId))
        : input.recipientId
          ? and(eq(messages.id, requestedReplyToId), sql`${messages.groupId} IS NULL`, or(
              and(eq(messages.senderId, req.session.userId!), eq(messages.recipientId, input.recipientId)),
              and(eq(messages.senderId, input.recipientId), eq(messages.recipientId, req.session.userId!)),
            ))
          : and(eq(messages.id, requestedReplyToId), sql`${messages.groupId} IS NULL AND ${messages.recipientId} IS NULL`);
      const [target] = await db.select({ content: messages.content, senderName: users.username })
        .from(messages).innerJoin(users, eq(messages.senderId, users.id)).where(replyConditions).limit(1);
      if (!target) return res.status(400).json({ message: "That message is no longer available to reply to." });
      replyContext = target;
      replyToId = requestedReplyToId;
    }
    const rawContent = String(input.content || "");
    const explicitMentionIds = Array.from(rawContent.matchAll(/<@(\d+)>/g), match => Number(match[1]));
    const hasEveryoneMention = rawContent.includes("<!everyone>");
    if (hasEveryoneMention && !input.groupId) return res.status(400).json({ message: "@everyone can only be used in a group channel." });
    let mentionRecipientIds = Array.from(new Set(explicitMentionIds)).filter(id => id !== Number(req.session.userId!));
    if (input.groupId && (mentionRecipientIds.length || hasEveryoneMention)) {
      const members = await db.select({ userId: groupChatMembers.userId }).from(groupChatMembers)
        .where(eq(groupChatMembers.groupId, input.groupId));
      const memberIds = new Set(members.map(member => Number(member.userId)));
      // A stale/global user suggestion must never prevent an otherwise valid
      // chat message from being sent. Only actual channel members receive pings.
      mentionRecipientIds = mentionRecipientIds.filter(id => Number.isInteger(id) && memberIds.has(id));
      if (hasEveryoneMention) mentionRecipientIds = Array.from(memberIds).filter(id => id !== Number(req.session.userId!));
    } else if (input.recipientId) {
      mentionRecipientIds = mentionRecipientIds.filter(id => id === Number(input.recipientId));
    } else if (mentionRecipientIds.length) {
      // Global chat supports direct @user pings too. Resolve IDs against real
      // accounts so stale suggestions never block sending the message.
      const mentionedUsers = await db.select({ id: users.id }).from(users)
        .where(inArray(users.id, mentionRecipientIds));
      const validIds = new Set(mentionedUsers.map(user => Number(user.id)));
      mentionRecipientIds = mentionRecipientIds.filter(id =>
        Number.isInteger(id) && id !== Number(req.session.userId!) && validIds.has(id)
      );
    }
    const message = await storage.createMessage({
      senderId: req.session.userId!,
      recipientId: input.recipientId,
      groupId: input.groupId,
      content: input.content,
      mediaUrl: input.mediaUrl ?? null,
      mediaType: input.mediaType ?? null,
      replyToId,
    });
    if (mentionRecipientIds.length) {
      try {
        await pool.query(
          `INSERT INTO nexus_chat_mention_notifications (user_id, message_id)
           SELECT target_id, $1 FROM unnest($2::int[]) AS targets(target_id)
           ON CONFLICT (user_id, message_id) DO NOTHING`,
          [message.id, mentionRecipientIds],
        );
      } catch (notificationError) {
        // Never turn a valid chat send into a failed message just because the
        // notification queue is temporarily unavailable.
        console.error("Chat mention notification enqueue failed:", notificationError);
      }
    }
    // Return the reply preview immediately as well as through the history query.
    // The optimistic client can therefore render the quoted message on first send.
    res.status(201).json({
      ...message,
      mediaUrl: null,
      hasMedia: Boolean(message.mediaUrl),
      replyToContent: replyContext?.content ?? null,
      replyToSenderName: replyContext?.senderName ?? null,
    });
  });

  app.get("/api/chat/mentions/poll", requireAuth, async (req, res) => {
    const result = await pool.query(
      `WITH pending AS (
         SELECT n.id, n.message_id, m.content, m.sender_id, u.username AS sender_name,
                u.display_name AS sender_display_name, u.nickname AS sender_nickname
         FROM nexus_chat_mention_notifications n
         JOIN messages m ON m.id = n.message_id
         JOIN users u ON u.id = m.sender_id
         WHERE n.user_id = $1
         ORDER BY n.id ASC
         LIMIT 30
         FOR UPDATE OF n SKIP LOCKED
       )
       DELETE FROM nexus_chat_mention_notifications n
       USING pending p
       WHERE n.id = p.id
       RETURNING p.message_id AS "messageId", p.content, p.sender_id AS "senderId",
                 p.sender_name AS "senderName", p.sender_display_name AS "senderDisplayName",
                 p.sender_nickname AS "senderNickname"`,
      [Number(req.session.userId!)],
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json(result.rows);
  });

  // Fetch interaction state for the currently open chat. Message visibility is
  // inherited from the same storage query used by the message list.
  app.get("/api/chat/interactions", requireAuth, async (req, res) => {
    const recipientId = req.query.recipientId ? Number(req.query.recipientId) : undefined;
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
    if (recipientId !== undefined && (!Number.isInteger(recipientId) || recipientId <= 0)) return res.status(400).json({ message: "Invalid recipient" });
    if (groupId !== undefined && (!Number.isInteger(groupId) || groupId <= 0)) return res.status(400).json({ message: "Invalid group" });
    if (recipientId && groupId) return res.status(400).json({ message: "Choose one chat channel" });
    const visibleMessages = await storage.getMessages(req.session.userId!, recipientId, groupId);
    const messageIds = visibleMessages.map((message: any) => Number(message.id)).filter(Number.isInteger);
    if (!messageIds.length) return res.json({ reactions: {}, polls: {} });
    const reactionRows = await db.select({ messageId: chatMessageReactions.messageId, userId: chatMessageReactions.userId, emoji: chatMessageReactions.emoji })
      .from(chatMessageReactions).where(inArray(chatMessageReactions.messageId, messageIds));
    const pollRows = await db.select().from(chatPolls).where(inArray(chatPolls.messageId, messageIds));
    const pollIds = pollRows.map(poll => poll.id);
    const optionRows = pollIds.length ? await db.select().from(chatPollOptions).where(inArray(chatPollOptions.pollId, pollIds)) : [];
    const voteRows = pollIds.length ? await db.select().from(chatPollVotes).where(inArray(chatPollVotes.pollId, pollIds)) : [];
    const reactions: Record<string, any[]> = {};
    for (const row of reactionRows) {
      const key = String(row.messageId);
      if (!reactions[key]) reactions[key] = [];
      const existing = reactions[key].find(item => item.emoji === row.emoji);
      if (existing) { existing.count += 1; existing.userIds.push(row.userId); }
      else reactions[key].push({ emoji: row.emoji, count: 1, userIds: [row.userId] });
    }
    const polls: Record<string, any> = {};
    for (const poll of pollRows) {
      const options = optionRows.filter(option => option.pollId === poll.id).map(option => {
        const votes = voteRows.filter(vote => vote.optionId === option.id);
        return { id: option.id, label: option.label, count: votes.length };
      });
      const pollVotes = voteRows.filter(vote => vote.pollId === poll.id);
      polls[String(poll.messageId)] = {
        id: poll.id,
        question: poll.question,
        options,
        totalVotes: pollVotes.length,
        myVote: pollVotes.find(vote => vote.userId === req.session.userId)?.optionId ?? null,
      };
    }
    res.json({ reactions, polls });
  });

  app.post("/api/chat/messages/:id/reactions", requireAuth, async (req, res) => {
    const messageId = Number(req.params.id);
    const emoji = typeof req.body?.emoji === "string" ? req.body.emoji : "";
    const allowedEmojis = ["👍", "❤️", "😂", "🔥", "🎉", "👀", "😭", "💀", "😍", "🥳", "🤔", "👏", "😮", "😢", "💯", "🙏"];
    if (!Number.isInteger(messageId) || messageId <= 0 || !allowedEmojis.includes(emoji)) return res.status(400).json({ message: "Choose a valid reaction." });
    const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message) return res.status(404).json({ message: "Message not found." });
    const otherUserId = message.recipientId ? (message.senderId === req.session.userId ? message.recipientId : message.senderId) : undefined;
    const visible = await storage.getMessages(req.session.userId!, otherUserId, message.groupId ?? undefined);
    if (!visible.some((item: any) => Number(item.id) === messageId)) return res.status(403).json({ message: "You cannot react to this message." });
    const [existing] = await db.select().from(chatMessageReactions).where(and(
      eq(chatMessageReactions.messageId, messageId),
      eq(chatMessageReactions.userId, req.session.userId!),
      eq(chatMessageReactions.emoji, emoji),
    )).limit(1);
    if (existing) await db.delete(chatMessageReactions).where(eq(chatMessageReactions.id, existing.id));
    else await db.insert(chatMessageReactions).values({ messageId, userId: req.session.userId!, emoji });
    res.json({ success: true, active: !existing });
  });

  app.post("/api/chat/polls", requireAuth, async (req, res) => {
    const question = typeof req.body?.question === "string" ? req.body.question.trim().slice(0, 180) : "";
    const options = Array.isArray(req.body?.options) ? req.body.options.map((value: any) => String(value).trim().slice(0, 80)).filter(Boolean) : [];
    const recipientId = req.body?.recipientId == null ? null : Number(req.body.recipientId);
    const groupId = req.body?.groupId == null ? null : Number(req.body.groupId);
    if (!question || options.length < 2 || options.length > 6 || new Set(options.map((value: string) => value.toLowerCase())).size !== options.length) {
      return res.status(400).json({ message: "A poll needs a question and 2–6 different options." });
    }
    if (recipientId !== null && (!Number.isInteger(recipientId) || recipientId <= 0 || recipientId === req.session.userId)) return res.status(400).json({ message: "Invalid DM recipient." });
    if (recipientId && groupId) return res.status(400).json({ message: "Choose a DM or group, not both." });
    if (recipientId && await blockedEitherWay(req.session.userId!, recipientId)) return res.status(403).json({ message: "You cannot create a poll in this DM." });
    if (groupId) {
      if (!Number.isInteger(groupId) || groupId <= 0) return res.status(400).json({ message: "Invalid group." });
      const [membership] = await db.select({ id: groupChatMembers.id }).from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupId, groupId), eq(groupChatMembers.userId, req.session.userId!))).limit(1);
      if (!membership) return res.status(403).json({ message: "You are not a member of this group." });
    }
    const [activeMute] = await db.select().from(moderationLogs)
      .where(and(eq(moderationLogs.targetId, req.session.userId!), sql`${moderationLogs.action} IN ('mute','timeout','jail','restrict','unmute','untimeout','unjail','unrestrict')`))
      .orderBy(desc(moderationLogs.createdAt)).limit(1);
    if (activeMute && !["unmute","untimeout","unjail","unrestrict"].includes(activeMute.action) && (!activeMute.expiresAt || activeMute.expiresAt > new Date())) {
      return res.status(403).json({ message: "You are currently muted or restricted." });
    }
    const created = await db.transaction(async tx => {
      const [message] = await tx.insert(messages).values({
        senderId: req.session.userId!,
        recipientId,
        groupId,
        content: question,
        mediaType: "poll",
      }).returning();
      const [poll] = await tx.insert(chatPolls).values({ messageId: message.id, question }).returning();
      await tx.insert(chatPollOptions).values(options.map((label: string, position: number) => ({ pollId: poll.id, label, position })));
      return message;
    });
    res.status(201).json(created);
  });

  app.post("/api/chat/polls/:id/vote", requireAuth, async (req, res) => {
    const pollId = Number(req.params.id);
    const optionId = Number(req.body?.optionId);
    if (!Number.isInteger(pollId) || !Number.isInteger(optionId)) return res.status(400).json({ message: "Invalid poll vote." });
    const [poll] = await db.select().from(chatPolls).where(eq(chatPolls.id, pollId)).limit(1);
    if (!poll) return res.status(404).json({ message: "Poll not found." });
    const [message] = await db.select().from(messages).where(eq(messages.id, poll.messageId)).limit(1);
    if (!message) return res.status(404).json({ message: "Poll message not found." });
    const otherUserId = message.recipientId ? (message.senderId === req.session.userId ? message.recipientId : message.senderId) : undefined;
    const visible = await storage.getMessages(req.session.userId!, otherUserId, message.groupId ?? undefined);
    if (!visible.some((item: any) => Number(item.id) === message.id)) return res.status(403).json({ message: "You cannot vote in this poll." });
    const [option] = await db.select().from(chatPollOptions).where(and(eq(chatPollOptions.id, optionId), eq(chatPollOptions.pollId, pollId))).limit(1);
    if (!option) return res.status(400).json({ message: "That option does not belong to this poll." });
    await db.transaction(async tx => {
      await tx.delete(chatPollVotes).where(and(eq(chatPollVotes.pollId, pollId), eq(chatPollVotes.userId, req.session.userId!)));
      await tx.insert(chatPollVotes).values({ pollId, optionId, userId: req.session.userId! });
    });
    res.json({ success: true });
  });

  app.get('/api/chat/messages/:id/media', requireAuth, async (req, res) => {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId)) return res.status(400).json({ message: 'Invalid message' });

    const [message] = await db.select({
      id: messages.id,
      senderId: messages.senderId,
      recipientId: messages.recipientId,
      groupId: messages.groupId,
      mediaUrl: messages.mediaUrl,
      mediaType: messages.mediaType,
    }).from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message || !message.mediaUrl) return res.status(404).json({ message: 'Attachment not found' });

    let allowed = !message.recipientId && !message.groupId;
    if (message.recipientId) {
      allowed = message.senderId === req.session.userId || message.recipientId === req.session.userId;
    }
    if (message.groupId) {
      const [membership] = await db.select({ id: groupChatMembers.id })
        .from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupId, message.groupId), eq(groupChatMembers.userId, req.session.userId!)))
        .limit(1);
      allowed = !!membership;
    }
    if (allowed && await blockedEitherWay(req.session.userId!, message.senderId)) allowed = false;
    if (!allowed) return res.status(403).json({ message: 'Attachment unavailable' });

    res.json({
      mediaUrl: message.mediaUrl.startsWith("file:")
        ? `/api/chat/messages/${messageId}/media/file`
        : message.mediaUrl,
      mediaType: message.mediaType,
    });
  });

  app.get('/api/chat/messages/:id/media/file', requireAuth, async (req, res) => {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId)) return res.status(400).json({ message: "Invalid message" });
    const [message] = await db.select({
      senderId: messages.senderId, recipientId: messages.recipientId,
      groupId: messages.groupId, mediaUrl: messages.mediaUrl,
    }).from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message?.mediaUrl || !/^file:[a-f0-9]{40}\.gif$/i.test(message.mediaUrl)) return res.status(404).json({ message: "Attachment not found" });
    let allowed = !message.recipientId && !message.groupId;
    if (message.recipientId) allowed = message.senderId === req.session.userId || message.recipientId === req.session.userId;
    if (message.groupId) {
      const [membership] = await db.select({ id: groupChatMembers.id }).from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupId, message.groupId), eq(groupChatMembers.userId, req.session.userId!))).limit(1);
      allowed = !!membership;
    }
    if (allowed && await blockedEitherWay(req.session.userId!, message.senderId)) allowed = false;
    if (!allowed) return res.status(403).json({ message: "Attachment unavailable" });
    try {
      const filename = message.mediaUrl.slice(5);
      const stored = await pool.query(
        "SELECT content FROM nexus_chat_gif_attachments WHERE filename = $1",
        [filename],
      );
      if (!stored.rows.length) return res.status(404).json({ message: "Saved GIF file is missing." });
      const bytes = Buffer.from(stored.rows[0].content);
      res.set({ "Content-Type": "image/gif", "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
      return res.send(bytes);
    } catch {
      return res.status(404).json({ message: "Saved GIF file is missing." });
    }
  });

  app.delete('/api/chat/messages/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    await db.delete(messages).where(and(eq(messages.id, id), eq(messages.senderId, req.session.userId!)));
    res.status(204).send();
  });

  // Soundboard broadcast - sends an SFX signal message to a channel so others auto-play it
  app.post('/api/chat/soundboard/play', requireAuth, async (req, res) => {
    const { soundUrl, soundName, recipientId, groupId } = req.body;
    const message = await storage.createMessage({
      senderId: req.session.userId!,
      recipientId: recipientId ?? null,
      groupId: groupId ?? null,
      content: `[SFX:${soundName}]`,
      mediaUrl: soundUrl,
      mediaType: 'sfx',
    });
    res.status(201).json(message);
  });

  app.post(api.chat.createGroup.path, requireAuth, async (req, res) => {
    const { name } = api.chat.createGroup.input.parse(req.body);
    const inviteCode = `GC-${randomBytes(3).toString('hex').toUpperCase()}`;
    const group = await storage.createGroup({
      name,
      inviteCode,
      ownerId: req.session.userId!
    });
    res.status(201).json(group);
  });

  app.post(api.chat.joinGroup.path, requireAuth, async (req, res) => {
    const { inviteCode } = api.chat.joinGroup.input.parse(req.body);
    const group = await storage.getGroupByCode(inviteCode);
    if (!group) {
      return res.status(404).json({ message: "Invalid group code" });
    }
    await storage.joinGroup(req.session.userId!, group.id);
    res.json(group);
  });

  app.get(api.chat.listGroups.path, requireAuth, async (req, res) => {
    const groups = await storage.getUserGroups(req.session.userId!);
    res.json(groups);
  });

  app.patch("/api/user/settings", requireAuth, async (req, res) => {
    const update: any = {};
    const { ringtoneUrl, muteNotifications, presenceStatus, muteEmotes, muteNonFriendCalls, dmFriendsOnly } = req.body;
    if (ringtoneUrl !== undefined) {
      update.ringtoneUrl = ringtoneUrl ? String(ringtoneUrl).slice(0, 500) : null;
    }
    if (muteNotifications !== undefined) {
      update.muteNotifications = Boolean(muteNotifications);
    }
    if (muteEmotes !== undefined) update.muteEmotes = Boolean(muteEmotes);
    if (muteNonFriendCalls !== undefined) update.muteNonFriendCalls = Boolean(muteNonFriendCalls);
    if (dmFriendsOnly !== undefined) update.dmFriendsOnly = Boolean(dmFriendsOnly);
    if (presenceStatus !== undefined && PRESENCE_STATUSES.includes(presenceStatus)) {
      update.presenceStatus = presenceStatus;
    }
    if (Object.keys(update).length) {
      update.lastSeen = new Date();
      await db.update(users).set(update).where(eq(users.id, req.session.userId!));
    }
    const updated = await storage.getUser(req.session.userId!);
    res.json(safeUser(updated));
  });

  // === USER PROFILE ===
  app.get("/api/user/profile/:id", requireAuth, async (req, res) => {
    const targetId = Number(req.params.id);
    const [user] = await db.select().from(users).where(eq(users.id, targetId));
    if (!user) return res.status(404).json({ message: "User not found" });

    // Find mutual group chats
    const myGroupRows = await db.select({ groupId: groupChatMembers.groupId })
      .from(groupChatMembers).where(eq(groupChatMembers.userId, req.session.userId!));
    const theirGroupRows = await db.select({ groupId: groupChatMembers.groupId })
      .from(groupChatMembers).where(eq(groupChatMembers.userId, targetId));
    const myIds = new Set(myGroupRows.map(r => r.groupId));
    const mutualIds = theirGroupRows.map(r => r.groupId).filter(id => myIds.has(id));
    const mutualGroups = mutualIds.length
      ? await db.select().from(groupChats).where(sql`${groupChats.id} IN (${sql.join(mutualIds.map(i => sql`${i}`), sql`, `)})`)
      : [];

    res.json({ ...safeUser(user), mutualGroups });
  });

  app.patch("/api/user/profile", requireAuth, async (req, res) => {
    try {
      const {
        username,
        nickname,
        displayName,
        bio,
        pronouns,
        avatarUrl,
        bannerUrl,
        usernameFont,
        profileGradient,
        tagSymbol,
        tagText,
        tagColor,
      } = req.body;
      const update: any = {};
      if (typeof username === 'string' && username.trim().length > 0) update.username = username.trim().replace(/\s+/g, '_').slice(0, 32);
      if (nickname !== undefined) update.nickname = nickname ? String(nickname).slice(0, 32) : null;
      if (displayName !== undefined) update.displayName = displayName ? String(displayName).slice(0, 32) : null;
      if (bio !== undefined) update.bio = bio ? String(bio).slice(0, 500) : null;
      if (pronouns !== undefined) update.pronouns = pronouns ? String(pronouns).slice(0, 32) : null;
      if (avatarUrl !== undefined && !isProfileImageProxyUrl(avatarUrl, req.session.userId!, "avatar")) {
        update.avatarUrl = typeof avatarUrl === 'string' && avatarUrl.length > 0 ? avatarUrl : null;
      }
      if (bannerUrl !== undefined && !isProfileImageProxyUrl(bannerUrl, req.session.userId!, "banner")) {
        const current = await storage.getUser(req.session.userId!);
        const staff = ["owner", "admin", "super_owner"].includes(String(current?.role || "").toLowerCase());
        const active = Boolean(current?.dihhroUntil && new Date(current.dihhroUntil) > new Date());
        const tier = staff ? "diamond" : active ? (current?.subscriptionTier === "none" ? "bronze" : String(current?.subscriptionTier || "bronze")) : "none";
        if (bannerUrl && !["gold", "diamond"].includes(tier)) return res.status(403).json({ message: "Profile banners require Galaxy Gold or Universe Diamond." });
        update.bannerUrl = typeof bannerUrl === 'string' && bannerUrl.length > 0 ? bannerUrl : null;
      }
      if (usernameFont !== undefined) {
        const fonts = ["default","neon","matrix","cyber","glitch","fire","ice","rainbow","ghost","elite","comic-sans"];
        const rawFont = String(usernameFont);
        const customText = /^custom-gradient\|(default|neon|matrix|cyber|glitch|fire|ice|rainbow|ghost|elite|comic-sans)\|#[0-9a-f]{6}\|#[0-9a-f]{6}(?:\|#[0-9a-f]{6})?$/i.test(rawFont);
        const customFont = /^custom-font\|data:(?:font\/(?:woff2?|ttf|otf)|application\/octet-stream);base64,[A-Za-z0-9+/=]+(?:\|#[0-9a-f]{6}\|#[0-9a-f]{6}\|#[0-9a-f]{6})?$/i.test(rawFont);
        if (customFont && rawFont.length > 400000) return res.status(413).json({ message: "Uploaded fonts must be 256 KB or smaller." });
        if (!fonts.includes(rawFont) && !customText && !customFont) return res.status(400).json({message:"Unsupported font or text gradient."});
        const current = await storage.getUser(req.session.userId!);
        const staff = ["owner", "admin", "super_owner"].includes(String(current?.role || "").toLowerCase());
        const active = Boolean(current?.dihhroUntil && new Date(current.dihhroUntil) > new Date());
        const tier = staff ? "diamond" : active ? (current?.subscriptionTier === "none" ? "bronze" : String(current?.subscriptionTier || "bronze")) : "none";
        const rank = ({ none: 0, bronze: 1, silver: 2, gold: 3, diamond: 4 } as Record<string, number>)[tier] || 0;
        if (rawFont !== "default" && rank < 2) return res.status(403).json({ message: "Username fonts require Solar System Silver or higher." });
        if ((rawFont.startsWith("custom-")) && rank < 3) return res.status(403).json({ message: "Custom username gradients and uploaded fonts require Galaxy Gold or higher." });
        const fontName = customText ? rawFont.split("|")[1] : rawFont;

        update.usernameFont = rawFont || null;
      }
      if (profileGradient !== undefined) {
        const rawGradient = String(profileGradient);
        const gradients = ["aurora","sunset","ocean","ember","violet","mint","mono","none"];
        const parts = rawGradient.split("~");
        const isStyle2 = parts.length === 6 && parts[0] === "style2";
        const selectedGradient = isStyle2 ? parts[1] : rawGradient;
        const customProfile = /^custom:#[0-9a-f]{6}:#[0-9a-f]{6}:#[0-9a-f]{6}$/i.test(selectedGradient);
        const validStyle2 = !isStyle2 || (
          /^#[0-9a-f]{6}$/i.test(parts[2] || "") &&
          /^#[0-9a-f]{6}$/i.test(parts[3] || "") &&
          ["0","1"].includes(parts[4]) &&
          ["portrait","landscape"].includes(parts[5])
        );
        if ((!gradients.includes(selectedGradient) && !customProfile) || !validStyle2) return res.status(400).json({message:"Invalid profile gradient settings."});
        const current = await storage.getUser(req.session.userId!);
        const hasDihtro = ["owner", "admin", "super_owner"].includes(String(current?.role || "").toLowerCase()) || Boolean(current?.dihhroUntil && new Date(current.dihhroUntil) > new Date());
        // A default style2 payload with gradient "none" is ordinary profile styling,
        // so saving a profile never requires a subscription unless a gradient is selected.
        if ((selectedGradient !== "none" || customProfile) && !hasDihtro) return res.status(403).json({ message: "Profile gradients require Planet Bronze or higher." });

        update.profileGradient = selectedGradient === "none" && !isStyle2 ? null : rawGradient;
      }
      if (tagSymbol !== undefined || tagText !== undefined || tagColor !== undefined) {
        if (tagText !== undefined && tagText !== null && typeof tagText !== "string") {
          return res.status(400).json({ message: "Tag text must be a string" });
        }

        const current = await storage.getUser(req.session.userId!);
        const staff = ["owner", "admin", "super_owner"].includes(String(current?.role || "").toLowerCase());
        const active = Boolean(current?.dihhroUntil && new Date(current.dihhroUntil) > new Date());
        const tier = staff ? "diamond" : active ? (current?.subscriptionTier === "none" ? "bronze" : String(current?.subscriptionTier || "bronze")) : "none";
        const rank = ({ none: 0, bronze: 1, silver: 2, gold: 3, diamond: 4 } as Record<string, number>)[tier] || 0;
        if (tagText && String(tagText).trim() && rank < 2) return res.status(403).json({ message: "Custom profile tags require Solar System Silver or higher." });
        const [currentUser] = await db
          .select({
            tagSymbol: users.tagSymbol,
            tagText: users.tagText,
            tagColor: users.tagColor,
          })
          .from(users)
          .where(eq(users.id, req.session.userId!));
        const nextTagText =
          tagText === null
            ? ""
            : typeof tagText === "string"
              ? normalizeProfileTagText(tagText)
              : currentUser?.tagText || "";

        if (!nextTagText) {
          update.tagSymbol = null;
          update.tagText = null;
          update.tagColor = null;
        } else {
          const nextTagSymbol =
            tagSymbol === undefined || tagSymbol === null
              ? currentUser?.tagSymbol || PROFILE_TAG_SYMBOLS[0]
              : tagSymbol;
          const nextTagColor =
            tagColor === undefined || tagColor === null
              ? currentUser?.tagColor || PROFILE_TAG_COLORS[0]
              : tagColor;

          if (!isProfileTagSymbol(nextTagSymbol)) {
            return res.status(400).json({ message: "Choose a valid profile tag symbol" });
          }
          if (!isProfileTagColor(nextTagColor)) {
            return res.status(400).json({ message: "Choose a valid profile tag color" });
          }

          update.tagSymbol = nextTagSymbol;
          update.tagText = nextTagText;
          update.tagColor = nextTagColor;
        }
      }
      // Always ensure at least one field
      if (Object.keys(update).length === 0) return res.json({ success: true });
      await db.update(users).set(update).where(eq(users.id, req.session.userId!));
      const [updated] = await db.select().from(users).where(eq(users.id, req.session.userId!));
      res.json(safeUser(updated));
    } catch (err: any) {
      console.error('Profile update error:', err);
      res.status(500).json({ message: err?.message || 'Update failed' });
    }
  });

  app.get(api.chat.users.path, requireAuth, async (_req, res) => {
    const usersList = await storage.getAllUsers();
    res.setHeader("Cache-Control", "no-store");
    res.json(usersList.map(safeUser));
  });

  // === FRIENDS & BLOCKS ===
  app.get("/api/social/relationship/:id", requireAuth, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId === req.session.userId) {
      return res.status(400).json({ message: "Invalid user" });
    }
    const [request] = await db.select().from(friendRequests).where(or(
      and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.addresseeId, targetId)),
      and(eq(friendRequests.requesterId, targetId), eq(friendRequests.addresseeId, req.session.userId!)),
    )).orderBy(desc(friendRequests.id)).limit(1);
    const [myBlock] = await db.select({ id: blocks.id }).from(blocks)
      .where(and(eq(blocks.blockerId, req.session.userId!), eq(blocks.blockedId, targetId))).limit(1);
    const [theirBlock] = await db.select({ id: blocks.id }).from(blocks)
      .where(and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, req.session.userId!))).limit(1);
    const blockedByMe = !!myBlock;
    const blockedMe = !!theirBlock;
    let friendStatus = "none";
    if (request?.status === "accepted") friendStatus = "accepted";
    else if (request?.status === "pending") {
      friendStatus = request.requesterId === req.session.userId ? "pending_sent" : "pending_received";
    }
    res.json({ friendStatus, friendRequestId: request?.id ?? null, blockedByMe, blockedMe });
  });

  app.get("/api/social/friends", requireAuth, async (req, res) => {
    const rows = await db.select().from(friendRequests).where(or(
      and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.status, "accepted")),
      and(eq(friendRequests.addresseeId, req.session.userId!), eq(friendRequests.status, "accepted")),
    )).orderBy(desc(friendRequests.createdAt));
    const friendIds = Array.from(new Set(rows.map(row => row.requesterId === req.session.userId ? row.addresseeId : row.requesterId)));
    const friendUsers = friendIds.length
      ? await db.select({
          id: users.id, username: users.username, displayName: users.displayName,
          nickname: users.nickname, avatarUrl: users.avatarUrl, presenceStatus: users.presenceStatus,
          pronouns: users.pronouns,
        }).from(users).where(sql`${users.id} IN (${sql.join(friendIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
     res.json(friendUsers.map(safeUser));
  });

  app.post("/api/social/friends/:id", requireAuth, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId === req.session.userId) {
      return res.status(400).json({ message: "Invalid user" });
    }
    if (await blockedEitherWay(req.session.userId!, targetId)) {
      return res.status(403).json({ message: "Unblock this user before sending a request" });
    }
    const targetAccount = await storage.getUser(targetId);
    if (!targetAccount) return res.status(404).json({ message: "User not found." });
    const [existing] = await db.select().from(friendRequests).where(or(
      and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.addresseeId, targetId)),
      and(eq(friendRequests.requesterId, targetId), eq(friendRequests.addresseeId, req.session.userId!)),
    )).orderBy(desc(friendRequests.id)).limit(1);
    if (existing?.status === "accepted") return res.json(existing);
    if (existing?.status === "pending") {
      if (existing.requesterId === targetId && existing.addresseeId === req.session.userId!) {
        const [accepted] = await db.update(friendRequests).set({ status: "accepted" }).where(eq(friendRequests.id, existing.id)).returning();
        return res.json(accepted);
      }
      return res.json(existing);
    }
    await db.delete(friendRequests).where(or(
      and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.addresseeId, targetId)),
      and(eq(friendRequests.requesterId, targetId), eq(friendRequests.addresseeId, req.session.userId!)),
    ));
    const [request] = await db.insert(friendRequests).values({
      requesterId: req.session.userId!, addresseeId: targetId, status: "pending",
    }).returning();
    res.status(201).json(request);
  });

  app.patch("/api/social/friends/:requestId", requireAuth, async (req, res) => {
    const requestId = Number(req.params.requestId);
    const status = req.body?.status;
    if (!["accepted", "rejected"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const [request] = await db.select().from(friendRequests)
      .where(and(eq(friendRequests.id, requestId), eq(friendRequests.addresseeId, req.session.userId!), eq(friendRequests.status, "pending")));
    if (!request) return res.status(404).json({ message: "Friend request not found" });
    const [updated] = await db.update(friendRequests).set({ status }).where(eq(friendRequests.id, requestId)).returning();
    res.json(updated);
  });

  app.delete("/api/social/friends/:id", requireAuth, async (req, res) => {
    const targetId = Number(req.params.id);
    await db.delete(friendRequests).where(and(
      or(
        and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.addresseeId, targetId)),
        and(eq(friendRequests.requesterId, targetId), eq(friendRequests.addresseeId, req.session.userId!)),
      ),
      eq(friendRequests.status, "accepted"),
    ));
    res.status(204).send();
  });

  app.get("/api/social/blocks", requireAuth, async (req, res) => {
    const rows = await db.select({
      id: blocks.id, userId: users.id, username: users.username,
      displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(blocks).innerJoin(users, eq(blocks.blockedId, users.id))
      .where(eq(blocks.blockerId, req.session.userId!)).orderBy(desc(blocks.createdAt));
    res.json(rows.map(safeUser));
  });

  app.post("/api/social/blocks/:id", requireAuth, async (req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId === req.session.userId) return res.status(400).json({ message: "Invalid user" });
    await db.insert(blocks).values({ blockerId: req.session.userId!, blockedId: targetId }).onConflictDoNothing();
    await db.delete(friendRequests).where(or(
      and(eq(friendRequests.requesterId, req.session.userId!), eq(friendRequests.addresseeId, targetId)),
      and(eq(friendRequests.requesterId, targetId), eq(friendRequests.addresseeId, req.session.userId!)),
    ));
    res.status(201).json({ success: true });
  });

  app.delete("/api/social/blocks/:id", requireAuth, async (req, res) => {
    await db.delete(blocks).where(and(eq(blocks.blockerId, req.session.userId!), eq(blocks.blockedId, Number(req.params.id))));
    res.status(204).send();
  });

  // === SHOP ===
  app.get("/api/shop/items", requireAuth, async (req, res) => {
    const items = await storage.getShopItems();
    res.json(items);
  });

  app.post("/api/shop/buy", requireAuth, async (req, res) => {
    const { itemId } = req.body;
    try {
      await storage.buyItem(req.session.userId!, itemId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/shop/inventory", requireAuth, async (req, res) => {
    const inventory = await storage.getUserInventory(req.session.userId!);
    res.json(inventory);
  });

  app.post("/api/shop/equip", requireAuth, async (req, res) => {
    const parseOptionalId = (value: unknown) => value == null || value === "" ? null : Number(value);
    const decorationId = parseOptionalId(req.body?.decorationId);
    const nameStyleId = parseOptionalId(req.body?.nameStyleId);
    if ((decorationId !== null && (!Number.isSafeInteger(decorationId) || decorationId < 1)) ||
        (nameStyleId !== null && (!Number.isSafeInteger(nameStyleId) || nameStyleId < 1))) {
      return res.status(400).json({ message: "Invalid shop item." });
    }
    const inventory = await storage.getUserInventory(req.session.userId!);
    if (decorationId !== null && !inventory.some((item:any) => item.id === decorationId && item.type === "decoration")) {
      return res.status(403).json({ message: "You do not own that decoration." });
    }
    if (nameStyleId !== null && !inventory.some((item:any) => item.id === nameStyleId && item.type === "name_style")) {
      return res.status(403).json({ message: "You do not own that name style." });
    }
    await storage.updateUserDecoration(req.session.userId!, decorationId, nameStyleId);
    res.json({ success: true });
  });

  app.post("/api/admin/shop_items", requireOwner, async (req, res) => {
    const item = await storage.createShopItem(req.body);
    res.status(201).json(item);
  });

  app.post("/api/shop/create", requireAuth, async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const name = String(body.name ?? "").trim().slice(0, 40);
      const description = String(body.description ?? "").trim().slice(0, 180);
      const type = String(body.type ?? "").trim().toLowerCase();
      const price = Number(body.price);

      if (!name || !["decoration", "emote"].includes(type) ||
          !Number.isSafeInteger(price) || price < 0 || price > 100000) {
        return res.status(400).json({ message: "Enter a name, valid item type and price." });
      }

      // Accept the data URLs emitted by FileReader, including harmless whitespace
      // inserted by clients, while still rejecting remote URLs and other formats.
      const rawImage = String(body.imageUrl ?? "").replace(/\s/g, "");
      const imageMatch = rawImage.match(/^data:(image\/(?:png|gif));base64,([A-Za-z0-9+/]*={0,2})$/i);
      const imageMime = imageMatch?.[1]?.toLowerCase();
      const imageBytes = imageMatch ? Math.floor(imageMatch[2].length * 3 / 4) : 0;
      if (!imageMatch || (type === "emote" && imageMime !== "image/gif") ||
          imageBytes <= 0 || imageBytes > 3 * 1024 * 1024) {
        return res.status(400).json({
          message: type === "decoration"
            ? "Upload a PNG or GIF decoration smaller than 3 MB."
            : "Upload a GIF emote smaller than 3 MB."
        });
      }

      let suppliedStyles: any = body.cssStyles ?? {};
      if (typeof suppliedStyles === "string") {
        try { suppliedStyles = JSON.parse(suppliedStyles || "{}"); }
        catch { return res.status(400).json({ message: "The item settings could not be read. Please reset the editor settings and try again." }); }
      }
      if (!suppliedStyles || typeof suppliedStyles !== "object" || Array.isArray(suppliedStyles)) {
        return res.status(400).json({ message: "The item settings must be a valid object." });
      }

      let styles: any;
      if (type === "decoration") {
        // Static decoration transforms: accept both current and legacy editor field names.
        const numberOr = (value: any, fallback: number) => {
          if (value === undefined || value === null || value === "") return fallback;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : fallback;
        };
        const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
        const scale = clamp(numberOr(suppliedStyles.scale, 1), 0.1, 5);
        const scaleX = clamp(numberOr(suppliedStyles.scaleX, 1), 0.1, 5);
        const scaleY = clamp(numberOr(suppliedStyles.scaleY, 1), 0.1, 5);
        const rotationAngle = clamp(numberOr(suppliedStyles.rotationAngle ?? suppliedStyles.rotation, 0), -360, 360);
        const offsetX = clamp(numberOr(suppliedStyles.offsetX, 0), -100, 100);
        const offsetY = clamp(numberOr(suppliedStyles.offsetY, 0), -100, 100);
        styles = { kind: "decoration", scale, scaleX, scaleY, rotationAngle, offsetX, offsetY };
      } else {
        const audioUrl = String(suppliedStyles.audioUrl ?? "").replace(/\s/g, "");
        const audioMatch = audioUrl.match(/^data:audio\/(?:mpeg|mp3);base64,([A-Za-z0-9+/]*={0,2})$/i);
        const audioBytes = audioMatch ? Math.floor(audioMatch[1].length * 3 / 4) : 0;
        if (!audioMatch || audioBytes <= 0 || audioBytes > 1.4 * 1024 * 1024) {
          return res.status(400).json({ message: "Emotes need an MP3 smaller than 1.4 MB." });
        }
        const duration = Number(suppliedStyles.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 20) {
          return res.status(400).json({ message: "MP3 duration must be between 0 and 20 seconds." });
        }
        styles = { kind: "emote", audioUrl, duration };
      }

      const item = await storage.createShopItem({
        name, description, type, price, imageUrl: rawImage,
        cssStyles: JSON.stringify({ ...styles, creatorId: Number(req.session.userId!) })
      });
      return res.status(201).json(item);
    } catch (error) {
      console.error("[shop/create] Failed to publish item:", error);
      return res.status(500).json({ message: "The shop could not save this item. Please try again." });
    }
  });

  app.post("/api/admin/dihcoins/grant", requireAdmin, async (req, res) => {
    const targetId = Number(req.body?.userId);
    const amount = Number(req.body?.amount);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) return res.status(400).json({ message: "Enter a valid member and amount (1–100,000)." });
    const target = await storage.getUser(targetId);
    if (!target) return res.status(404).json({ message: "Member not found." });
    const balance = Number(target.coins || 0);
    if (!Number.isSafeInteger(balance) || balance + amount > 2147483647) return res.status(400).json({ message: "That balance is too large." });
    await db.update(users).set({ coins: String(balance + amount) }).where(eq(users.id, targetId));
    await db.insert(moderationLogs).values({ actorId: Number(req.session.userId!), targetId, action: "galactic_coins_grant", reason: "Staff currency grant", metadata: { amount } });
    res.json({ success: true, userId: targetId, amount, balance: balance + amount });
  });

  const blockBlastComboRewardCooldown = new Map<number, number>();
  app.post("/api/blockblast/combo-reward", requireAuth, async (req, res) => {
    const combo = Number(req.body?.combo);
    if (!Number.isInteger(combo) || combo < 2 || combo > 5) return res.status(400).json({ message: "Only a valid combo can earn Galactic Coins." });
    const userId = Number(req.session.userId!);
    const now = Date.now();
    if (now - (blockBlastComboRewardCooldown.get(userId) || 0) < 1200) return res.status(429).json({ message: "Combo reward is cooling down." });
    const account = await storage.getUser(userId);
    const balance = Number(account?.coins || 0);
    if (!Number.isSafeInteger(balance) || balance < 0 || balance + 10 > 2147483647) return res.status(400).json({ message: "Could not update Galactic Coins balance." });
    blockBlastComboRewardCooldown.set(userId, now);
    const nextBalance = balance + 10;
    await db.update(users).set({ coins: String(nextBalance) }).where(eq(users.id, userId));
    res.json({ success: true, awarded: 10, coins: nextBalance });
  });

  // === VOICE CALL SIGNALING — authenticated WebRTC signalling ===
  // Signals and call sessions are process-local; run one server instance unless these
  // maps are moved to shared storage/pub-sub (Redis or the database).
  interface CallSession { callerId: number; calleeId: number; withVideo: boolean; }
  const activeCalls = new Map<string, Set<number>>();

  // Call invites and WebRTC signals live in Neon, not process memory. This is
  // essential when the caller and recipient hit different API instances or
  // when the server restarts while a call is ringing.
  const pushVoiceSignal = async (userId: number, signal: any) => {
    await pool.query(
      `INSERT INTO nexus_voice_signals (recipient_id, call_id, payload) VALUES ($1, $2, $3::jsonb)`,
      [userId, typeof signal.callId === "string" ? signal.callId : null, JSON.stringify({ ...signal, createdAt: Date.now() })],
    );
  };

  const getCallPeer = async (callId: unknown, userId: number) => {
    if (typeof callId !== "string" || !callId) return null;
    const result = await pool.query(
      `SELECT call_id, caller_id, callee_id, with_video, status
       FROM nexus_voice_calls
       WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)
         AND (status = 'active' OR expires_at > NOW())
       LIMIT 1`,
      [callId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      call: { callId: row.call_id, callerId: Number(row.caller_id), calleeId: Number(row.callee_id), withVideo: Boolean(row.with_video), status: row.status },
      peerId: Number(row.caller_id) === userId ? Number(row.callee_id) : Number(row.caller_id),
    };
  };

  // Authenticated WebRTC mesh signalling for the shared Block Blast voice room.
  const blockBlastMembers = new Map<number,string>();
  const blockBlastSignals = new Map<number,any[]>();
  app.post("/api/blockblast/voice/join", requireAuth, async (req,res) => {
    const id=Number(req.session.userId!); const u=await storage.getUser(id); blockBlastMembers.set(id,u?.username||("Player "+id));
    res.json({participants:Array.from(blockBlastMembers.entries()).filter(([peer])=>peer!==id).map(([userId,username])=>({userId,username}))});
  });
  app.get("/api/blockblast/voice/participants", requireAuth, (req,res) => { const id=Number(req.session.userId!); res.json(Array.from(blockBlastMembers.entries()).filter(([peer])=>peer!==id).map(([userId,username])=>({userId,username}))); });
  app.post("/api/blockblast/voice/signal", requireAuth, (req,res) => {
    const from=Number(req.session.userId!), to=Number(req.body?.to); const signal=req.body?.signal;
    if(!blockBlastMembers.has(from)||!blockBlastMembers.has(to)||from===to) return res.status(403).json({message:"Both players must be in the voice room."});
    if(!signal||!["offer","answer","ice","left"].includes(signal.type)) return res.status(400).json({message:"Invalid WebRTC signal."});
    const queue=blockBlastSignals.get(to)||[]; queue.push({from,signal,createdAt:Date.now()}); if(queue.length>100)queue.splice(0,queue.length-100); blockBlastSignals.set(to,queue); res.json({success:true});
  });
  app.post("/api/blockblast/voice/emote", requireAuth, async (req,res) => {
    const userId=Number(req.session.userId!);
    if(!blockBlastMembers.has(userId)) return res.status(403).json({message:"Join Block Blast voice first."});
    const emoteId=Number(req.body?.emoteId);
    const inventory=await storage.getUserInventory(userId);
    const item=inventory.find((entry:any)=>entry.id===emoteId&&entry.type==="emote");
    if(!item) return res.status(403).json({message:"You do not own that emote."});
    let styles:any={};try{styles=typeof item.cssStyles==="string"?JSON.parse(item.cssStyles):(item.cssStyles||{});}catch{}
    if(!styles.audioUrl||!item.imageUrl) return res.status(400).json({message:"This emote is incomplete."});
    const sender=await storage.getUser(userId);
    const payload={type:"emote",emote:{name:item.name,gifUrl:item.imageUrl,audioUrl:styles.audioUrl,duration:Math.min(20,Number(styles.duration)||3),fromName:sender?.username||"Player"}};
    for(const peer of blockBlastMembers.keys()){
      if(peer===userId)continue;
      const peerAccount=await storage.getUser(peer);
      if(peerAccount?.muteEmotes)continue;
      const queue=blockBlastSignals.get(peer)||[];
      queue.push({from:userId,signal:payload,createdAt:Date.now()});
      if(queue.length>100)queue.splice(0,queue.length-100);
      blockBlastSignals.set(peer,queue);
    }
    res.json({success:true});
  });

  app.get("/api/blockblast/voice/signals", requireAuth, (req,res) => { const id=Number(req.session.userId!); const queue=blockBlastSignals.get(id)||[]; blockBlastSignals.set(id,[]); res.json(queue.filter(item=>Date.now()-item.createdAt<60000)); });
  app.post("/api/blockblast/voice/leave", requireAuth, (req,res) => {
    const id=Number(req.session.userId!); blockBlastMembers.delete(id);
    for(const peer of blockBlastMembers.keys()){const queue=blockBlastSignals.get(peer)||[];queue.push({from:id,signal:{type:"left"},createdAt:Date.now()});blockBlastSignals.set(peer,queue);}
    blockBlastSignals.delete(id); res.json({success:true});
  });
  app.get('/api/chat/voice/ice-config', requireAuth, (_req, res) => {
    const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
    let iceServers = fallback;
    const configured = process.env.WEBRTC_ICE_SERVERS;
    if (configured) {
      try {
        const parsed = JSON.parse(configured);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((item) => item && typeof item === 'object' && item.urls)) {
          iceServers = parsed;
        }
      } catch (error) {
        console.error('WEBRTC_ICE_SERVERS must be a valid JSON array:', error);
      }
    }
    res.set('Cache-Control', 'no-store').json({ iceServers });
  });

  app.post('/api/chat/voice/start', requireAuth, async (req, res) => {
    const calleeId = Number(req.body?.calleeId);
    const callerId = Number(req.session.userId!);
    const withVideo = Boolean(req.body?.withVideo);
    if (!Number.isInteger(calleeId) || calleeId <= 0 || calleeId === callerId) {
      return res.status(400).json({ message: 'Invalid call recipient' });
    }
    const callee = await storage.getUser(calleeId);
    if (!callee) return res.status(404).json({ message: 'User not found' });
    if (await blockedEitherWay(callerId, calleeId)) return res.status(403).json({ message: 'This user is unavailable' });
    if (callee.muteNonFriendCalls && !(await areAcceptedFriends(callerId, calleeId))) {
      return res.status(403).json({ message: "This user only accepts calls from friends." });
    }

    const callId = `call-${Date.now()}-${randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO nexus_voice_calls (call_id, caller_id, callee_id, with_video, status, expires_at)
       VALUES ($1, $2, $3, $4, 'ringing', NOW() + INTERVAL '45 seconds')`,
      [callId, callerId, calleeId, withVideo],
    );
    const caller = await storage.getUser(callerId);
    await pushVoiceSignal(calleeId, {
      type: 'incoming', callId, fromId: callerId,
      fromName: caller?.username || `User_${callerId}`, withVideo,
    });
    res.json({ callId });
  });

  app.post('/api/chat/voice/accept', requireAuth, async (req, res) => {
    const callId = req.body?.callId;
    const result = await pool.query(
      `UPDATE nexus_voice_calls SET status = 'active'
       WHERE call_id = $1 AND callee_id = $2 AND status = 'ringing'
         AND expires_at > NOW()
       RETURNING caller_id`,
      [callId, Number(req.session.userId!)],
    );
    const call = result.rows[0];
    if (!call) return res.status(404).json({ message: 'Call not found or expired' });
    await pushVoiceSignal(Number(call.caller_id), { type: 'accepted', callId });
    res.json({ success: true });
  });

  app.post('/api/chat/voice/offer', requireAuth, async (req, res) => {
    const { callId, recipientId, offer } = req.body || {};
    const peer = await getCallPeer(callId, Number(req.session.userId!));
    if (!peer || peer.peerId !== Number(recipientId)) return res.status(403).json({ message: 'Invalid call participant' });
    if (!offer || typeof offer.sdp !== 'string' || !['offer'].includes(String(offer.type))) {
      return res.status(400).json({ message: 'Invalid WebRTC offer' });
    }
    await pushVoiceSignal(peer.peerId, { type: 'offer', callId, from: req.session.userId!, offer });
    res.json({ success: true });
  });

  app.post('/api/chat/voice/answer', requireAuth, async (req, res) => {
    const { callId, recipientId, answer } = req.body || {};
    const peer = await getCallPeer(callId, Number(req.session.userId!));
    if (!peer || peer.peerId !== Number(recipientId)) return res.status(403).json({ message: 'Invalid call participant' });
    if (!answer || typeof answer.sdp !== 'string' || answer.type !== 'answer') {
      return res.status(400).json({ message: 'Invalid WebRTC answer' });
    }
    await pushVoiceSignal(peer.peerId, { type: 'answer', callId, from: req.session.userId!, answer });
    res.json({ success: true });
  });

  app.post('/api/chat/voice/ice', requireAuth, async (req, res) => {
    const { callId, recipientId, candidate } = req.body || {};
    const peer = await getCallPeer(callId, Number(req.session.userId!));
    if (!peer || peer.peerId !== Number(recipientId)) return res.status(403).json({ message: 'Invalid call participant' });
    if (!candidate || typeof candidate.candidate !== 'string') return res.status(400).json({ message: 'Invalid ICE candidate' });
    await pushVoiceSignal(peer.peerId, { type: 'ice', callId, from: req.session.userId!, candidate });
    res.json({ success: true });
  });

  app.post('/api/chat/voice/emote', requireAuth, async (req, res) => {
    const userId = Number(req.session.userId!);
    const peer = await getCallPeer(req.body?.callId, userId);
    if (!peer) return res.status(403).json({ message: "You must be in an active call to send an emote." });
    const emoteId = Number(req.body?.emoteId);
    const inventory = await storage.getUserInventory(userId);
    const item = inventory.find((entry:any) => entry.id === emoteId && entry.type === "emote");
    if (!item) return res.status(403).json({ message: "You do not own that emote." });
    let styles:any = {};
    try { styles = typeof item.cssStyles === "string" ? JSON.parse(item.cssStyles) : (item.cssStyles || {}); } catch {}
    if (!styles.audioUrl || !item.imageUrl) return res.status(400).json({ message: "This emote is incomplete." });
    await pushVoiceSignal(peer.peerId, { type: "emote", callId: req.body.callId, from: userId, emote: { name: item.name, gifUrl: item.imageUrl, audioUrl: styles.audioUrl, duration: Math.min(20, Number(styles.duration) || 3) } });
    res.json({ success: true });
  });

  app.post('/api/chat/voice/decline', requireAuth, async (req, res) => {
    const callId = req.body?.callId;
    const result = await pool.query(
      `SELECT caller_id, callee_id FROM nexus_voice_calls WHERE call_id = $1 LIMIT 1`,
      [callId],
    );
    const call = result.rows[0];
    if (!call) return res.json({ success: true });
    if (Number(call.callee_id) !== Number(req.session.userId!)) return res.status(403).json({ message: 'Only the invited recipient can decline this call' });
    await pushVoiceSignal(Number(call.caller_id), { type: 'declined', callId });
    await pool.query(`DELETE FROM nexus_voice_calls WHERE call_id = $1`, [callId]);
    res.json({ success: true });
  });

  app.post('/api/chat/voice/end', requireAuth, async (req, res) => {
    const callId = req.body?.callId;
    const peer = await getCallPeer(callId, Number(req.session.userId!));
    if (!peer) return res.json({ success: true });
    await pushVoiceSignal(peer.peerId, { type: 'ended', callId });
    await pool.query(`DELETE FROM nexus_voice_calls WHERE call_id = $1`, [callId]);
    res.json({ success: true });
  });

  app.get('/api/chat/voice/poll', requireAuth, async (req, res) => {
    const userId = Number(req.session.userId!);
    const result = await pool.query(
      `DELETE FROM nexus_voice_signals
       WHERE id IN (
         SELECT id FROM nexus_voice_signals
         WHERE recipient_id = $1 AND created_at > NOW() - INTERVAL '2 minutes'
         ORDER BY id LIMIT 250
       )
       RETURNING payload`,
      [userId],
    );
    res.set('Cache-Control', 'no-store').json(result.rows.map(row => row.payload));
  });

  // Optional group-call presence endpoints retained for existing clients.
  app.get('/api/chat/voice/active', requireAuth, (req, res) => {
    const { id, isGroup } = req.query;
    const key = `${isGroup ? 'g' : 'u'}${id}`;
    res.json(Array.from(activeCalls.get(key) || new Set<number>()));
  });
  app.post('/api/chat/voice/join', requireAuth, (req, res) => {
    const { id, isGroup } = req.body || {};
    const key = `${isGroup ? 'g' : 'u'}${id}`;
    const participants = activeCalls.get(key) || new Set<number>();
    participants.add(Number(req.session.userId!));
    activeCalls.set(key, participants);
    res.json({ success: true });
  });
  app.post('/api/chat/voice/leave', requireAuth, (req, res) => {
    const { id, isGroup } = req.body || {};
    const key = `${isGroup ? 'g' : 'u'}${id}`;
    const participants = activeCalls.get(key);
    if (participants) {
      participants.delete(Number(req.session.userId!));
      if (!participants.size) activeCalls.delete(key);
    }
    res.json({ success: true });
  });

  // === ACCESS REQUESTS (public - no auth required) ===
  app.post('/api/access-requests', accessRequestRateLimit, async (req, res) => {
    try {
      const { username, name, password, message } = req.body;
      const requestedUsername = String(username || name || "").trim();
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(requestedUsername)) return res.status(400).json({ message: "Username must be 3–24 characters using letters, numbers, dots, dashes or underscores." });
      if (typeof password !== "string" || password.length < 8 || password.length > 128) return res.status(400).json({ message: "Password must be between 8 and 128 characters." });
      if (typeof message !== "string" || message.trim().length < 5 || message.trim().length > 500) return res.status(400).json({ message: "Tell us why you want to join (5–500 characters)." });
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, requestedUsername)).limit(1);
      if (existing) return res.status(409).json({ message: "That username is already taken." });
      const request = await storage.createAccessRequest({ name: requestedUsername, passwordHash: hashAccountPassword(password), message: message.trim() });
      res.status(201).json({ id: request.id, name: request.name, message: request.message, status: request.status, createdAt: request.createdAt });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed' });
    }
  });

  app.get('/api/admin/requests', requireAdmin, async (req, res) => {
    const requests = await storage.listAccessRequests();
    res.json(requests);
  });

  app.patch('/api/admin/requests/:id', requireAdmin, async (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId < 1) return res.status(400).json({ message: 'Invalid request.' });
    const request = await storage.getAccessRequest(requestId);
    if (!request) return res.status(404).json({ message: 'Access request not found.' });
    if (request.status !== "pending") return res.status(409).json({ message: "This request has already been reviewed." });
    if (status === "approved") {
      if (!request.passwordHash) return res.status(400).json({ message: "This older request has no saved password. Ask the applicant to submit a new request." });
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, request.name)).limit(1);
      if (existing) return res.status(409).json({ message: "That username is now taken. Reject this request and ask them to apply with another username." });
      const [created] = await db.insert(users).values({
        username: request.name,
        serialKey: "ACCOUNT-" + randomBytes(24).toString("hex"),
        passwordHash: request.passwordHash,
        role: "user",
      }).returning({ id: users.id });
      await storage.updateAccessRequestStatus(requestId, "approved", created.id);
      return res.json({ success: true, accountCreated: true, userId: created.id, username: request.name });
    }
    await storage.updateAccessRequestStatus(requestId, status);
    return res.json({ success: true, accountCreated: false });
  });

  // === GIPHY GIF SEARCH ===
  app.get('/api/gifs/search', requireAuth, async (req, res) => {
    try {
      const apiKey = process.env.GIPHY_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: 'GIPHY is not configured yet. Add GIPHY_API_KEY in Replit Secrets.' });
      }
      const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      if (!query) return res.status(400).json({ message: 'Enter something to search for.' });
      const parsedLimit = Number(req.query.limit || 24);
      const limit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(24, parsedLimit)) : 24;
      const params = new URLSearchParams({
        api_key: apiKey, q: query, limit: String(limit), rating: 'g', lang: 'en',
        bundle: 'messaging_non_clips',
      });
      const upstream = await fetch(`https://api.giphy.com/v1/gifs/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        console.error('[giphy] Search failed:', upstream.status);
        return res.status(502).json({ message: 'GIPHY search is temporarily unavailable. Please try again.' });
      }
      const payload = await upstream.json() as any;
      const data = (Array.isArray(payload?.data) ? payload.data : []).map((gif: any) => {
        const images = gif?.images || {};
        const original = images.original || images.downsized_large || images.fixed_width;
        const preview = images.fixed_width || images.preview_gif || original;
        if (!original?.url || !preview?.url) return null;
        return {
          id: String(gif.id || original.url),
          title: String(gif.title || 'GIPHY GIF').slice(0, 160),
          url: original.url,
          previewUrl: preview.url,
          sourceUrl: String(gif.url || 'https://giphy.com/'),
          license: 'GIPHY',
        };
      }).filter(Boolean);
      res.set('Cache-Control', 'private, max-age=60');
      res.json({ data });
    } catch (error: any) {
      console.error('[giphy] Search error:', error?.message || error);
      res.status(502).json({ message: 'Could not connect to GIPHY. Please try again.' });
    }
  });

  // === CUSTOM EMOJIS ===
  app.get('/api/emojis', requireAuth, async (req, res) => {
    const emojis = await storage.listCustomEmojis();
    res.json(emojis);
  });

  app.post('/api/admin/emojis', requireOwner, async (req, res) => {
    try {
      const { name, url } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length < 1) {
        return res.status(400).json({ message: 'Name is required' });
      }
      if (!url || typeof url !== 'string' || !url.startsWith('data:image/')) {
        return res.status(400).json({ message: 'A valid image URL is required' });
      }
      const emoji = await storage.createCustomEmoji({ name: name.trim().toLowerCase().replace(/\s+/g, '_'), url, createdBy: req.session.userId! });
      res.status(201).json(emoji);
    } catch (err: any) {
      if (err?.message?.includes('unique')) return res.status(409).json({ message: 'Emoji name already exists' });
      res.status(500).json({ message: err?.message || 'Failed' });
    }
  });

  app.delete('/api/admin/emojis/:id', requireOwner, async (req, res) => {
    await storage.deleteCustomEmoji(Number(req.params.id));
    res.status(204).send();
  });

  // === PROXY ===
  app.get(api.proxy.fetch.path, requireAuth, async (req, res) => {
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).send("Missing URL");

      // Validate URL
      let parsed: URL;
      try { parsed = new URL(targetUrl); } catch { return res.status(400).send("Invalid URL"); }

      const { lookup } = await import("node:dns/promises");
      const { isIP } = await import("node:net");
      const isPublicAddress = (address: string) => {
        const value = address.toLowerCase().split("%")[0];
        if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return false;
        if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
        const parts = value.split(".").map(Number);
        if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
          const [a,b] = parts;
          return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
        }
        return true;
      };
      const validateTarget = async (value: string) => {
        const candidate = new URL(value);
        if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
          throw new Error("Only public HTTP or HTTPS URLs are supported.");
        }
        const host = candidate.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
        if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
            host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) {
          throw new Error("Private and local network addresses are not available through the proxy.");
        }
        const literal = isIP(host);
        const addresses = literal ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
          throw new Error("Private and local network addresses are not available through the proxy.");
        }
        return candidate;
      };
      let currentUrl = parsed.toString();
      let response: Response | undefined;
      for (let redirect = 0; redirect <= 5; redirect++) {
        await validateTarget(currentUrl);
        response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(25_000),
        });
        if (![301,302,303,307,308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location || redirect === 5) throw new Error("The destination redirected too many times.");
        currentUrl = new URL(location, currentUrl).toString();
      }
      if (!response) throw new Error("The destination did not return a response.");
      parsed = new URL(currentUrl);

      const contentType = response.headers.get('content-type') || 'text/html; charset=utf-8';

      // Strip headers that prevent iframe embedding
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.set({
        'Content-Type': contentType,
        'X-Frame-Options': 'ALLOWALL',
        'Access-Control-Allow-Origin': '*',
      });

      if (contentType.includes('text/html')) {
        let html = await response.text();
        const base = parsed.origin;

        // Remove meta/http-equiv that set X-Frame-Options or CSP
        html = html.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, '');
        html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '');

        // Inject base tag so relative URLs resolve correctly
        if (!html.match(/<base\s/i)) {
          if (html.match(/<head[^>]*>/i)) {
            html = html.replace(/(<head[^>]*>)/i, `$1<base href="${currentUrl}">`);
          } else {
            html = `<base href="${currentUrl}">` + html;
          }
        }

        // Inject small script to allow links to navigate within the proxy iframe
        const proxyScript = `<script>
(function(){
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');
    if(a&&a.href&&!a.href.startsWith('javascript')){
      e.preventDefault();
      var abs=new URL(a.href,document.baseURI).href;
      window.location.href='/api/proxy?url='+encodeURIComponent(abs);
    }
  },true);
  var f=document.createElement('base');f.target='_self';
})();
</script>`;
        html = html.replace('</head>', proxyScript + '</head>');

        res.send(html);
      } else {
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
      }

      // Log history asynchronously
      storage.createHistory({
        userId: req.session.userId!,
        url: targetUrl,
        query: "Proxy Visit"
      }).catch(console.error);

    } catch (err: any) {
      console.error("Proxy error:", err);
      res.status(502).send(`<!DOCTYPE html><html><body style="background:#111;color:#0f0;font-family:monospace;padding:30px">
        <h2 style="color:#f55">[PROXY_ERROR]</h2>
        <p><b>TARGET:</b> ${req.query.url}</p>
        <p><b>REASON:</b> ${err.message || 'Connection refused or timeout'}</p>
        <p style="color:#888">Some sites (Roblox, Google, etc.) block server-side requests. Try: wikipedia.org, github.com, reddit.com</p>
      </body></html>`);
    }
  });


  // === GROUP VOICE / VIDEO ROOMS ===
  // Mesh WebRTC signalling. Each participant maintains one peer connection per other participant.
  interface GroupVoiceRoom { id: string; groupId: number | null; ownerId: number; withVideo: boolean; participants: Map<number,string>; invited: Set<number>; createdAt: number; }
  const groupVoiceRooms = new Map<string,GroupVoiceRoom>();
  const groupVoiceSignals = new Map<number,any[]>();
  const pushGroupVoiceSignal = (userId:number, payload:any) => {
    const queue=groupVoiceSignals.get(userId)||[];
    queue.push({...payload,createdAt:Date.now()});
    if(queue.length>250) queue.splice(0,queue.length-250);
    groupVoiceSignals.set(userId,queue);
  };
  const getGroupVoiceRoom = (roomId:unknown,userId:number) => {
    if(typeof roomId!=="string") return null;
    const room=groupVoiceRooms.get(roomId);
    return room && room.participants.has(userId) ? room : null;
  };
  const isGroupChatMember = async (groupId:number,userId:number) => {
    const [membership]=await db.select({id:groupChatMembers.id}).from(groupChatMembers)
      .where(and(eq(groupChatMembers.groupId,groupId),eq(groupChatMembers.userId,userId))).limit(1);
    return !!membership;
  };
  app.post("/api/chat/group-voice/start",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!), groupId=Number(req.body?.groupId);
    if(!Number.isInteger(groupId)||groupId<=0) return res.status(400).json({message:"Choose a valid group chat."});
    if(!await isGroupChatMember(groupId,userId)) return res.status(403).json({message:"You are not a member of this group."});
    const [group]=await db.select({id:groupChats.id}).from(groupChats).where(eq(groupChats.id,groupId)).limit(1);
    if(!group) return res.status(404).json({message:"Group not found."});
    const user=await storage.getUser(userId);
    const roomId="group-call-"+Date.now()+"-"+randomBytes(8).toString("hex");
    const room:GroupVoiceRoom={id:roomId,groupId,ownerId:userId,withVideo:Boolean(req.body?.withVideo),participants:new Map([[userId,user?.username||("User_"+userId)]]),invited:new Set(),createdAt:Date.now()};
    groupVoiceRooms.set(roomId,room);
    res.json({roomId,participants:[]});
  });

  const areAcceptedFriends = async (firstId:number,secondId:number) => {
    const [friendship] = await db.select({id:friendRequests.id}).from(friendRequests).where(and(
      eq(friendRequests.status,"accepted"),
      or(
        and(eq(friendRequests.requesterId,firstId),eq(friendRequests.addresseeId,secondId)),
        and(eq(friendRequests.requesterId,secondId),eq(friendRequests.addresseeId,firstId)),
      ),
    )).limit(1);
    return !!friendship;
  };
  app.post("/api/chat/group-voice/direct-start",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!),targetId=Number(req.body?.calleeId);
    if(!Number.isInteger(targetId)||targetId<=0||targetId===userId) return res.status(400).json({message:"Choose a valid friend to call."});
    if(!await areAcceptedFriends(userId,targetId)) return res.status(403).json({message:"You can only call someone who is already your friend."});
    if(await blockedEitherWay(userId,targetId)) return res.status(403).json({message:"This person is unavailable."});
    const target=await storage.getUser(targetId),caller=await storage.getUser(userId);
    if(!target) return res.status(404).json({message:"Friend not found."});
    const roomId="friend-call-"+Date.now()+"-"+randomBytes(8).toString("hex");
    const withVideo=Boolean(req.body?.withVideo);
    const room:GroupVoiceRoom={id:roomId,groupId:null,ownerId:userId,withVideo,participants:new Map([[userId,caller?.username||("User_"+userId)]]),invited:new Set([targetId]),createdAt:Date.now()};
    groupVoiceRooms.set(roomId,room);
    pushGroupVoiceSignal(targetId,{type:"group-invite",roomId,groupId:null,groupName:"Friend call",directCall:true,fromId:userId,fromName:caller?.username||"A friend",withVideo});
    res.json({roomId,participants:[],withVideo});
  });
  app.get("/api/chat/group-voice/members",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!),groupId=Number(req.query.groupId);
    if(!Number.isInteger(groupId)||groupId<=0||!await isGroupChatMember(groupId,userId)) return res.status(403).json({message:"You are not a member of this group."});
    const members=await db.select({userId:users.id,username:users.username}).from(groupChatMembers)
      .innerJoin(users,eq(groupChatMembers.userId,users.id)).where(eq(groupChatMembers.groupId,groupId));
    res.json(members);
  });
  app.post("/api/chat/group-voice/invite",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!), targetId=Number(req.body?.userId), room=getGroupVoiceRoom(req.body?.roomId,userId);
    if(!room) return res.status(403).json({message:"You are not in this group call."});
    if(!Number.isInteger(targetId)||targetId<=0||targetId===userId) return res.status(400).json({message:"Choose a valid person to invite."});
    if(!await areAcceptedFriends(userId,targetId)) return res.status(403).json({message:"You can only invite someone who is already your friend."});
    if(room.participants.has(targetId)||room.invited.has(targetId)) return res.status(409).json({message:"That friend is already in or invited to the call."});
    const target=await storage.getUser(targetId);
    if(!target) return res.status(404).json({message:"User not found."});
    if(await blockedEitherWay(userId,targetId)) return res.status(403).json({message:"This person is unavailable."});
    const [group]=room.groupId ? await db.select({name:groupChats.name}).from(groupChats).where(eq(groupChats.id,room.groupId)).limit(1) : [];
    const inviter=await storage.getUser(userId);
    room.invited.add(targetId);
    pushGroupVoiceSignal(targetId,{type:"group-invite",roomId:room.id,groupId:room.groupId,groupName:group?.name||"Friend call",directCall:room.groupId===null,fromId:userId,fromName:inviter?.username||"A friend",withVideo:room.withVideo});
    res.json({success:true});
  });
  app.post("/api/chat/group-voice/join",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!),roomId=req.body?.roomId;
    const room=typeof roomId==="string"?groupVoiceRooms.get(roomId):null;
    if(!room) return res.status(404).json({message:"This group call has ended."});
    if(room.groupId!==null&&!await isGroupChatMember(room.groupId,userId)) return res.status(403).json({message:"You are not a member of this group."});
    if(room.groupId===null&&!room.invited.has(userId)) return res.status(403).json({message:"You need a valid friend-call invitation to join."});
    if(room.participants.has(userId)) return res.status(409).json({message:"You are already in this call."});
    room.invited.delete(userId);
    const user=await storage.getUser(userId);
    room.participants.set(userId,user?.username||("User_"+userId));
    const participants=Array.from(room.participants.entries()).filter(([id])=>id!==userId).map(([userId,username])=>({userId,username}));
    res.json({roomId,withVideo:room.withVideo,participants});
  });
  app.post("/api/chat/group-voice/decline",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!),roomId=req.body?.roomId;
    const room=typeof roomId==="string"?groupVoiceRooms.get(roomId):null;
    if(!room||!room.invited.has(userId)) return res.json({success:true});
    room.invited.delete(userId);
    const decliner=await storage.getUser(userId);
    pushGroupVoiceSignal(room.ownerId,{type:"group-invite-declined",roomId:room.id,userId,username:decliner?.username||"Your friend"});
    res.json({success:true});
  });
  app.post("/api/chat/group-voice/signal",requireAuth,(req,res)=>{
    const userId=Number(req.session.userId!),to=Number(req.body?.to),room=getGroupVoiceRoom(req.body?.roomId,userId),signal=req.body?.signal;
    if(!room||!room.participants.has(to)||to===userId) return res.status(403).json({message:"Both people must be in this group call."});
    if(!signal||!["offer","answer","ice","left"].includes(signal.type)) return res.status(400).json({message:"Invalid WebRTC signal."});
    pushGroupVoiceSignal(to,{type:"group-signal",roomId:room.id,from:userId,signal});
    res.json({success:true});
  });
  app.get("/api/chat/group-voice/poll",requireAuth,(req,res)=>{
    const userId=Number(req.session.userId!),queue=groupVoiceSignals.get(userId)||[];
    groupVoiceSignals.set(userId,[]);
    res.json(queue.filter(item=>Date.now()-item.createdAt<90000));
  });
  app.post("/api/chat/group-voice/leave",requireAuth,(req,res)=>{
    const userId=Number(req.session.userId!),roomId=req.body?.roomId,room=typeof roomId==="string"?groupVoiceRooms.get(roomId):null;
    if(room&&room.participants.has(userId)){
      room.participants.delete(userId);
      for(const peerId of room.participants.keys()) pushGroupVoiceSignal(peerId,{type:"group-signal",roomId:room.id,from:userId,signal:{type:"left"}});
      if(!room.participants.size) groupVoiceRooms.delete(room.id);
    }
    res.json({success:true});
  });

  // Lightweight shared 2D hangout rooms. State is process-local and expires when empty.
  type HangoutPlayer = { id:number; username:string; x:number; y:number; color:string; direction:string; lastSeen:number };
  type HangoutRoom = { id:string; name:string; theme:string; players:Map<number,HangoutPlayer>; messages:Array<{id:string;username:string;text:string;createdAt:number}>; updatedAt:number };
  const hangoutRooms = new Map<string,HangoutRoom>();
  const hangoutColors = ["#8b5cf6","#0ea5e9","#ec4899","#10b981","#f59e0b","#f43f5e","#a855f7","#14b8a6"];
  const hangoutPublic = (room:HangoutRoom) => ({
    id:room.id,name:room.name,theme:room.theme,
    players:Array.from(room.players.values()).map(({lastSeen:_lastSeen,...player})=>player),
    messages:room.messages.slice(-60),
  });
  const cleanupHangouts = () => {
    const now=Date.now();
    for(const [id,room] of hangoutRooms){
      for(const [playerId,player] of room.players) if(now-player.lastSeen>45000) room.players.delete(playerId);
      if(!room.players.size || now-room.updatedAt>15*60*1000) hangoutRooms.delete(id);
    }
  };
  app.get("/api/hangouts/rooms",requireAuth,(_req,res)=>{
    cleanupHangouts();
    res.json(Array.from(hangoutRooms.values()).map(room=>({id:room.id,name:room.name,theme:room.theme,players:Array.from(room.players.values()).map(({lastSeen:_lastSeen,...player})=>player)})));
  });
  app.post("/api/hangouts/create",requireAuth,async(req,res)=>{
    cleanupHangouts();
    const userId=Number(req.session.userId!),user=await storage.getUser(userId);
    if(!user) return res.status(401).json({message:"Please sign in again."});
    if(hangoutRooms.size>=30) return res.status(429).json({message:"There are too many active rooms. Try joining one instead."});
    const name=String(req.body?.name||"").trim().slice(0,32)||"Chill Hangout";
    const theme=String(req.body?.theme||"plaza");
    if(!["plaza","beach","forest","arcade"].includes(theme)) return res.status(400).json({message:"Choose a valid room map."});
    const id=randomBytes(8).toString("hex");
    const player:HangoutPlayer={id:userId,username:String(user.username||"Player").slice(0,32),x:48,y:52,color:hangoutColors[userId%hangoutColors.length],direction:"down",lastSeen:Date.now()};
    const room:HangoutRoom={id,name,theme,players:new Map([[userId,player]]),messages:[],updatedAt:Date.now()};
    hangoutRooms.set(id,room);
    res.json(hangoutPublic(room));
  });
  app.post("/api/hangouts/join",requireAuth,async(req,res)=>{
    cleanupHangouts();
    const userId=Number(req.session.userId!),roomId=String(req.body?.roomId||""),room=hangoutRooms.get(roomId);
    if(!room) return res.status(404).json({message:"That hangout has closed."});
    const user=await storage.getUser(userId);
    if(!user) return res.status(401).json({message:"Please sign in again."});
    if(!room.players.has(userId)&&room.players.size>=16) return res.status(409).json({message:"This room is full."});
    if(!room.players.has(userId)) room.players.set(userId,{id:userId,username:String(user.username||"Player").slice(0,32),x:15+Math.random()*70,y:20+Math.random()*60,color:hangoutColors[userId%hangoutColors.length],direction:"down",lastSeen:Date.now()});
    room.updatedAt=Date.now();
    res.json(hangoutPublic(room));
  });
  app.get("/api/hangouts/state",requireAuth,(req,res)=>{
    cleanupHangouts();
    const userId=Number(req.session.userId!),room=hangoutRooms.get(String(req.query.roomId||""));
    if(!room||!room.players.has(userId)) return res.status(404).json({message:"This hangout has closed or you have left."});
    const player=room.players.get(userId)!;player.lastSeen=Date.now();room.updatedAt=Date.now();
    res.json(hangoutPublic(room));
  });
  app.post("/api/hangouts/move",requireAuth,(req,res)=>{
    const userId=Number(req.session.userId!),room=hangoutRooms.get(String(req.body?.roomId||""));
    if(!room||!room.players.has(userId)) return res.status(404).json({message:"You are no longer in this room."});
    const player=room.players.get(userId)!;
    const x=Number(req.body?.x),y=Number(req.body?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)) return res.status(400).json({message:"Invalid player position."});
    player.x=Math.max(5,Math.min(95,x));player.y=Math.max(10,Math.min(90,y));player.lastSeen=Date.now();room.updatedAt=Date.now();
    res.json({success:true});
  });
  app.post("/api/hangouts/chat",requireAuth,async(req,res)=>{
    const userId=Number(req.session.userId!),room=hangoutRooms.get(String(req.body?.roomId||""));
    if(!room||!room.players.has(userId)) return res.status(404).json({message:"Join the room before chatting."});
    const text=String(req.body?.text||"").trim();
    if(!text||text.length>240) return res.status(400).json({message:"Messages must be between 1 and 240 characters."});
    const player=room.players.get(userId)!;
    player.lastSeen=Date.now();room.updatedAt=Date.now();
    room.messages.push({id:randomBytes(8).toString("hex"),username:player.username,text,createdAt:Date.now()});
    if(room.messages.length>100) room.messages.splice(0,room.messages.length-100);
    res.json({success:true});
  });
  app.post("/api/hangouts/leave",requireAuth,(req,res)=>{
    const userId=Number(req.session.userId!),room=hangoutRooms.get(String(req.body?.roomId||""));
    if(room){room.players.delete(userId);room.updatedAt=Date.now();if(!room.players.size)hangoutRooms.delete(room.id);}
    res.json({success:true});
  });


  // === COMMUNITY SERVERS (separate from legacy group chats) ===
  const serverAccess = async (serverId: number, userId: number) => {
    const [server] = await db.select().from(communityServers).where(eq(communityServers.id, serverId)).limit(1);
    if (!server) return { server: null, member: null };
    const [member] = await db.select().from(communityServerMembers).where(and(eq(communityServerMembers.serverId, serverId), eq(communityServerMembers.userId, userId))).limit(1);
    return { server, member: member || null };
  };
  const canManageServer = (server: any, member: any) => Boolean(member && (server.ownerId === member.userId || ["owner", "admin"].includes(member.role)));

  app.get("/api/servers", requireAuth, async (req, res) => {
    const userId = Number(req.session.userId);
    const rows = await db.select({
      id: communityServers.id, name: communityServers.name, description: communityServers.description,
      visibility: communityServers.visibility, inviteCode: communityServers.inviteCode,
      ownerId: communityServers.ownerId, role: communityServerMembers.role,
    }).from(communityServers).leftJoin(communityServerMembers, and(eq(communityServerMembers.serverId, communityServers.id), eq(communityServerMembers.userId, userId)))
      .where(or(eq(communityServers.visibility, "public"), eq(communityServerMembers.userId, userId))).orderBy(desc(communityServers.createdAt));
    res.set("Cache-Control", "private, no-store");
    res.json(rows);
  });

  app.post("/api/servers", requireAuth, async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 500) : "";
    const visibility = req.body?.visibility === "public" ? "public" : "private";
    if (name.length < 2 || name.length > 48) return res.status(400).json({ message: "Server names must be 2–48 characters." });
    const ownerId = Number(req.session.userId);
    try {
      const created = await db.transaction(async (tx) => {
        const [server] = await tx.insert(communityServers).values({ name, description, visibility, ownerId, inviteCode: randomBytes(5).toString("hex").toUpperCase() }).returning();
        await tx.insert(communityServerMembers).values({ serverId: server.id, userId: ownerId, role: "owner" });
        const [category] = await tx.insert(communityServerCategories).values({ serverId: server.id, name: "GENERAL", position: 0 }).returning();
        await tx.insert(communityServerChannels).values({ serverId: server.id, categoryId: category.id, name: "general", type: "text", position: 0 });
        return server;
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("[servers] create failed:", error);
      res.status(500).json({ message: "Could not create the server. Please try again." });
    }
  });

  app.get("/api/servers/:id", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id);
    if (!Number.isInteger(serverId) || serverId < 1) return res.status(400).json({ message: "Invalid server." });
    const { server, member } = await serverAccess(serverId, Number(req.session.userId));
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (server.visibility !== "public" && !member) return res.status(403).json({ message: "Join this private server to view it." });
    const categories = await db.select().from(communityServerCategories).where(eq(communityServerCategories.serverId, serverId)).orderBy(communityServerCategories.position);
    const channels = await db.select().from(communityServerChannels).where(eq(communityServerChannels.serverId, serverId)).orderBy(communityServerChannels.position);
    const members = await db.select({
      userId: communityServerMembers.userId, role: communityServerMembers.role,
      username: users.username, avatarUrl: users.avatarUrl, presenceStatus: users.presenceStatus,
    }).from(communityServerMembers).innerJoin(users, eq(users.id, communityServerMembers.userId)).where(eq(communityServerMembers.serverId, serverId));
    res.set("Cache-Control", "private, no-store");
    res.json({ server, member, categories, channels, members });
  });

  app.post("/api/servers/join", requireAuth, async (req, res) => {
    const code = typeof req.body?.inviteCode === "string" ? req.body.inviteCode.trim().toUpperCase() : "";
    if (!/^[A-F0-9]{10}$/.test(code)) return res.status(400).json({ message: "Enter a valid server invite code." });
    const [server] = await db.select().from(communityServers).where(eq(communityServers.inviteCode, code)).limit(1);
    if (!server) return res.status(404).json({ message: "That server invite was not found." });
    await db.insert(communityServerMembers).values({ serverId: server.id, userId: Number(req.session.userId), role: "member" }).onConflictDoNothing();
    res.json({ success: true, serverId: server.id });
  });

  app.post("/api/servers/:id/join", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id);
    if (!Number.isInteger(serverId) || serverId < 1) return res.status(400).json({ message: "Invalid server." });
    const [server] = await db.select().from(communityServers).where(eq(communityServers.id, serverId)).limit(1);
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (server.visibility !== "public") return res.status(403).json({ message: "This server requires an invite code." });
    await db.insert(communityServerMembers).values({ serverId, userId: Number(req.session.userId), role: "member" }).onConflictDoNothing();
    res.json({ success: true, serverId });
  });

  app.post("/api/servers/:id/leave", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id), userId = Number(req.session.userId);
    const { server, member } = await serverAccess(serverId, userId);
    if (!server || !member) return res.status(404).json({ message: "Server membership not found." });
    if (server.ownerId === userId) return res.status(400).json({ message: "Transfer ownership or delete the server before leaving." });
    await db.delete(communityServerMembers).where(and(eq(communityServerMembers.serverId, serverId), eq(communityServerMembers.userId, userId)));
    res.json({ success: true });
  });

  app.patch("/api/servers/:id", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id);
    const { server, member } = await serverAccess(serverId, Number(req.session.userId));
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (!canManageServer(server, member)) return res.status(403).json({ message: "You cannot manage this server." });
    const changes: { name?: string; description?: string; visibility?: string } = {};
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (name.length < 2 || name.length > 48) return res.status(400).json({ message: "Server names must be 2–48 characters." });
      changes.name = name;
    }
    if (typeof req.body?.description === "string") changes.description = req.body.description.trim().slice(0, 500);
    if (["public", "private"].includes(req.body?.visibility)) changes.visibility = req.body.visibility;
    if (!Object.keys(changes).length) return res.status(400).json({ message: "No valid server settings supplied." });
    const [updated] = await db.update(communityServers).set(changes).where(eq(communityServers.id, serverId)).returning();
    res.json(updated);
  });

  app.delete("/api/servers/:id", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id), userId = Number(req.session.userId);
    const { server } = await serverAccess(serverId, userId);
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (server.ownerId !== userId) return res.status(403).json({ message: "Only the server owner can delete it." });
    await db.delete(communityServers).where(eq(communityServers.id, serverId));
    res.json({ success: true });
  });

  app.post("/api/servers/:id/categories", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id);
    const { server, member } = await serverAccess(serverId, Number(req.session.userId));
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (!canManageServer(server, member)) return res.status(403).json({ message: "You cannot manage channels." });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 40) : "";
    if (!name) return res.status(400).json({ message: "Category name is required." });
    const [category] = await db.insert(communityServerCategories).values({ serverId, name, position: Date.now() % 100000000 }).returning();
    res.status(201).json(category);
  });

  app.get("/api/servers/:id/channels/:channelId/messages", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id), channelId = Number(req.params.channelId);
    if (!Number.isInteger(serverId) || serverId < 1 || !Number.isInteger(channelId) || channelId < 1) {
      return res.status(400).json({ message: "Invalid server or channel." });
    }
    const { server, member } = await serverAccess(serverId, Number(req.session.userId));
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (server.visibility !== "public" && !member) return res.status(403).json({ message: "Join this private server to view messages." });
    const [channel] = await db.select({ id: communityServerChannels.id }).from(communityServerChannels)
      .where(and(eq(communityServerChannels.id, channelId), eq(communityServerChannels.serverId, serverId))).limit(1);
    if (!channel) return res.status(404).json({ message: "Channel not found." });
    const rows = await db.select({
      id: communityServerMessages.id, channelId: communityServerMessages.channelId,
      authorId: communityServerMessages.authorId, content: communityServerMessages.content,
      createdAt: communityServerMessages.createdAt, editedAt: communityServerMessages.editedAt,
      username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl,
    }).from(communityServerMessages)
      .innerJoin(users, eq(users.id, communityServerMessages.authorId))
      .where(and(eq(communityServerMessages.serverId, serverId), eq(communityServerMessages.channelId, channelId)))
      .orderBy(desc(communityServerMessages.createdAt)).limit(100);
    res.set("Cache-Control", "private, no-store").json(rows.reverse());
  });

  app.post("/api/servers/:id/channels/:channelId/messages", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id), channelId = Number(req.params.channelId);
    const userId = Number(req.session.userId);
    if (!Number.isInteger(serverId) || serverId < 1 || !Number.isInteger(channelId) || channelId < 1) {
      return res.status(400).json({ message: "Invalid server or channel." });
    }
    const { server, member } = await serverAccess(serverId, userId);
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (!member) return res.status(403).json({ message: "Join this server before sending messages." });
    const [channel] = await db.select().from(communityServerChannels)
      .where(and(eq(communityServerChannels.id, channelId), eq(communityServerChannels.serverId, serverId))).limit(1);
    if (!channel) return res.status(404).json({ message: "Channel not found." });
    if (channel.type === "voice") return res.status(400).json({ message: "Voice channels do not accept text messages." });
    if (channel.isLocked && !canManageServer(server, member)) return res.status(403).json({ message: "This channel is locked." });
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content || content.length > 2000) return res.status(400).json({ message: "Messages must be between 1 and 2,000 characters." });
    const [message] = await db.insert(communityServerMessages).values({ serverId, channelId, authorId: userId, content }).returning();
    const [author] = await db.select({ username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users).where(eq(users.id, userId)).limit(1);
    res.status(201).json({ ...message, ...author });
  });

  app.post("/api/servers/:id/channels", requireAuth, async (req, res) => {
    const serverId = Number(req.params.id);
    const { server, member } = await serverAccess(serverId, Number(req.session.userId));
    if (!server) return res.status(404).json({ message: "Server not found." });
    if (!canManageServer(server, member)) return res.status(403).json({ message: "You cannot manage channels." });
    const name = typeof req.body?.name === "string" ? req.body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48) : "";
    const type = ["text", "voice", "announcement", "forum", "media"].includes(req.body?.type) ? req.body.type : "text";
    const categoryId = req.body?.categoryId == null ? null : Number(req.body.categoryId);
    if (!name) return res.status(400).json({ message: "Channel name is required." });
    if (categoryId !== null) {
      const [category] = await db.select({ id: communityServerCategories.id }).from(communityServerCategories).where(and(eq(communityServerCategories.id, categoryId), eq(communityServerCategories.serverId, serverId))).limit(1);
      if (!category) return res.status(400).json({ message: "Choose a category from this server." });
    }
    const [channel] = await db.insert(communityServerChannels).values({
      serverId, categoryId, name, type,
      topic: typeof req.body?.topic === "string" ? req.body.topic.trim().slice(0, 160) : "",
      position: Date.now() % 100000000,
    }).returning();
    res.status(201).json(channel);
  });

  return httpServer;
}
