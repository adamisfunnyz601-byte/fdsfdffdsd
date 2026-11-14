# Deployment infrastructure

## Neon PostgreSQL

The application already uses Drizzle ORM with the `pg` (node-postgres) driver and reads `DATABASE_URL`. Neon can use this connection string directly; no ORM migration is required.

From the repository root, run:

```bash
npm i -g neon@latest
neon init -y --org-id org-solitary-boat-10841343 --project-id holy-wind-18564456 --branch production --services postgres
neon config plan
neon deploy
```

If the global install is unavailable, use `npx neon@latest` in place of `neon`. Authenticate first with `neon auth` if the CLI reports that no account is signed in.

The CLI links the directory and pulls Neon-managed environment variables into `.env` or `.env.local`. Never commit either file. The project should receive `DATABASE_URL` from Neon. Use the pooled URL for the long-running web app and keep `DATABASE_URL_UNPOOLED` for migration/admin tasks when needed.

After linking, apply the existing Drizzle schema deliberately:

```bash
npm install
npm run db:push
npm run build
npm run check
```

Review the Neon branch and take a backup before applying schema changes to any database containing important data. Do not point the new deployment at the old production database until the migration plan is confirmed.

## Cloudflare R2

R2 is separate from Neon. Create a bucket and an R2 API token restricted to that bucket with Object Read & Write permissions. Store the credentials as environment secrets on the eventual app host, never in Git.

Required environment variables for the R2 adapter:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

Optional:

- `R2_PUBLIC_BASE_URL` — only if the bucket is deliberately exposed through a public custom domain. Leave unset for private media.

The S3 endpoint is `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` and the S3 region is `auto`.

**Important current-code note:** this repository currently accepts profile and chat media as data URLs and stores them in PostgreSQL. The R2 bucket is not yet wired into those upload/read routes. Do not switch off the existing database media path until the R2 adapter, authenticated media delivery, and migration of existing media have been implemented and tested.

## Runtime hosting

Neon is the database and R2 is object storage; neither runs the Express application. A Node.js web-service host is still required. Configure its start command as `npm start`, set `NODE_ENV=production`, and provide `DATABASE_URL`, `SESSION_SECRET`, and any OAuth/Turnstile/R2 secrets the enabled features need.
