# Todoodle

A calm place to capture tasks and get them done, together.

One Cloudflare Worker (Hono) serves the API and the React SPA (static assets), backed by D1.
Three environments with fully separate data: **local**, **staging**, **production**.

```
apps/api         Worker: request pipeline, /health, /api/*, /test/*
apps/web         Vite + React 19 + Tailwind v4 + shadcn SPA
packages/shared  shared constants (limits.ts)
migrations/      D1 migrations
scripts/         release command (deploy.ts) and its building blocks
e2e/             Playwright end-to-end tests
```

## Prerequisites

- [bun](https://bun.sh) 1.2+ (package manager and script runner)
- Node.js 20+ (used internally by wrangler, vitest and Playwright)
- For e2e tests: `bunx playwright install chromium webkit` once

## Local development

```sh
bun install                 # installs every workspace
bun run db:migrate:local    # applies migrations to the local D1 in .wrangler/state
bun run dev                 # applies local migrations, builds the SPA (watch mode), runs wrangler dev
```

Open http://127.0.0.1:8787. Local development never connects to staging or production:
the base `wrangler.toml` environment is `local` and D1 state lives under `.wrangler/state`.

Check which version an environment is serving:

```sh
curl http://127.0.0.1:8787/health
# {"status":"ok","environment":"local","version":"dev","git_sha":"dev","deployed_at":null}
```

`/api/health` returns the same body.

## Tests

All tests run offline and refuse to run against anything other than `ENVIRONMENT=local`.

```sh
bun run test               # lint + unit + integration + ui
bun run test:unit
bun run test:integration
bun run test:ui            # web component tests (happy-dom)
bun run test:e2e           # Playwright; starts `bun run dev` itself
bun run typecheck
bun run lint               # web import rules (no barrels, per-icon lucide imports)
bun run tokens             # regenerate apps/web/src/styles/tokens.css from packages/shared/src/tokens.ts
```

Worker tests run inside workerd via `@cloudflare/vitest-pool-workers`, so tests are started by bun but
executed by vitest (not `bun test`).

## Releasing

Releases are manual:

```sh
bun run deploy:staging
bun run deploy:production   # requires main branch, a vX.Y.Z tag at HEAD and an interactive confirm
```

The release command: checks the working tree is clean, builds, lists pending D1 migrations, scans
them for irreversible patterns (blocks production, warns on staging), skips if the revision is
already live with nothing pending, applies migrations, publishes with up to 3 attempts, waits for
`/health` to report the new revision, tags `deploy/<env>/YYYYMMDD-HHMMSS` and appends a row to
`docs/ops/deployment-log.csv`. There is no automatic rollback.

### First-time setup

1. `bunx wrangler login`
2. `bunx wrangler d1 create todoodle-staging` and `bunx wrangler d1 create todoodle-production`
3. Put the returned ids into `wrangler.toml` (`[env.staging]` / `[env.production]` `database_id`).
4. Set the base URLs in `scripts/deploy/constants.ts` (`ENV_BASE_URLS`) if they differ from the defaults.

Secrets are never committed; use `wrangler secret put` (and `.dev.vars` locally, which is git-ignored).
