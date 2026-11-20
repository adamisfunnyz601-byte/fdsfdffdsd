# NEXUS database split

NEXUS uses two independent PostgreSQL databases:

- `MESSAGES_URL`: Enzonic pooled PostgreSQL connection for chat. Owns direct/group messages, community servers and messages, reactions, polls/votes, GIF attachments, call signalling, and chat-related records.
- `ACCOUNTS_URL`: Enzonic pooled PostgreSQL connection for accounts. Owns users, credentials, sessions, profiles, friends/blocks, access keys, passkeys, and account metadata.

The runtime and migration configs also accept the legacy aliases `DATABASE_URL` (chat) and `ENZONIC_DATABASE_URL` (accounts), but new deployments should use `MESSAGES_URL` and `ACCOUNTS_URL`.

The chat database contains only a minimal `users` projection (ID, username, display name, avatar, presence) so chat queries can display authors. Enzonic remains authoritative; this projection is refreshed every 30 seconds and contains no passwords or account secrets.

## Apply schema

Run both commands against their respective configured URLs:

```sh
npm run db:push
npm run db:push:enzonic
```

Do not point both connection variables at the same database. NEXUS requires both databases at startup.

## Chat retention

The Prisma cleanup worker checks every five minutes. At 1.6 GB it removes the oldest half of direct/group messages, community messages, and timestamped GIF attachments. Enzonic is never included in this cleanup. PostgreSQL DELETE makes space reusable but does not necessarily reduce the database's reported on-disk size; physical compaction is a separate maintenance operation.
