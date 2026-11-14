# Deployment infrastructure

## Neon PostgreSQL

The application already uses Drizzle ORM with the `pg` (node-postgres) driver and reads `DATABASE_URL`. Neon can use this connection string directly; no ORM migration is required.

After linking the project to Neon, apply the existing Drizzle schema deliberately:

```bash
npm install
npm run db:push
npm run build
npm run check
```

Review the Neon branch and take a backup before applying schema changes to any database containing important data.

## Backblaze B2 object storage

The configured bucket for this deployment is `nexus-uploads1` in region `us-east-005`.

Set these environment variables in the app host (and locally in an untracked `.env` file):

- `B2_KEY_ID` — Backblaze application key ID
- `B2_APPLICATION_KEY` — Backblaze application key secret
- `B2_BUCKET_NAME=nexus-uploads1`
- `B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com`
- `B2_REGION=us-east-005`

Create an application key scoped to this bucket with read and write permissions. Keep the key secret; never commit credentials to GitHub. The bucket can remain private; private chat attachments should be delivered through authenticated application routes rather than a public bucket URL.

**Implementation status:** the environment template and deployment settings identify B2, but the existing chat/profile upload routes still store media in PostgreSQL as data URLs. They have not yet been migrated to B2. Do not remove the legacy database-media path until upload, authenticated retrieval, profile image handling, and migration of existing media are implemented and tested.

## Runtime hosting

Neon is the database and Backblaze B2 is object storage; neither runs the Express application. A Node.js web-service host is still required. Configure its start command as `npm start`, set `NODE_ENV=production`, and provide `DATABASE_URL`, `SESSION_SECRET`, and any OAuth/Turnstile/B2 secrets the enabled features need.
