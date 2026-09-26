# Todoodle

A shared to-do list for getting things done together. One Cloudflare Worker (Hono) serves the
API and the React SPA; data lives in Cloudflare D1. Three environments with fully separate data:
local, staging and production.

## Prerequisites

- [bun](https://bun.sh) >= 1.2 (package manager and script runner)
- Node.js >= 20 (wrangler, vitest and Playwright run on Node under the hood)
- For e2e tests: `bunx playwright install chromium` once

## Local development

```sh
bun install                 # installs every workspace (apps/*, packages/*)
bun run db:migrate:local    # applies migrations/ to the local D1 database (.wrangler/state)
bun run dev                 # builds the SPA (watch mode) and runs wrangler dev
```

Open http://127.0.0.1:8787. The landing page shows the Todoodle heading.
`curl http://127.0.0.1:8787/health` reports `{"status":"ok","environment":"local",...}`.

Local development never connects to staging or production: it uses only the local D1 state
under `.wrangler/state`.

## Layout

| Path | What |
|---|---|
| `apps/api` | Worker entry (`src/index.ts`), Hono app, middleware, routes |
| `apps/web` | Vite + React 19 + Tailwind v4 + shadcn SPA, built to `apps/web/dist` |
| `packages/shared` | Constants shared by api, web and scripts (`src/limits.ts`) |
| `migrations/` | D1 migrations (SQL) |
| `scripts/` | Dev loop and release command (`deploy.ts`, `deploy/*`) |
| `e2e/` | Playwright end-to-end tests |
| `docs/ops/deployment-log.csv` | Record of every release attempt |

## Tests

All test suites run offline against local, in-process bindings only. They refuse to run when the
environment is not `local`.

```sh
bun run test               # unit + integration + ui (everything except e2e)
bun run test:unit          # api units (workerd) + deploy units (node)
bun run test:integration   # Worker end to end in workerd + release pipeline with a fake wrangler
bun run test:ui            # web component tests (happy-dom)
bun run test:e2e           # Playwright against `bun run dev` on 127.0.0.1:8787
bun run typecheck
```

## Releasing

Releases are manual only.

```sh
bun run deploy:staging
bun run deploy:production
```

The release command:

1. Prechecks: clean working tree. Production also requires branch `main`, a `vX.Y.Z` tag at HEAD,
   and an interactive confirmation.
2. Builds the SPA.
3. Lists pending D1 migrations and scans them for irreversible patterns (`DROP TABLE`,
   `TRUNCATE TABLE`, `ADD/DROP CONSTRAINT`, `CHECK (`, `ALTER TABLE .. MODIFY/CHANGE`).
   Production is refused and the offending file is named; staging warns and continues.
4. Skips the release ("already deployed") if the environment already reports the HEAD revision and
   no migrations are pending.
5. Applies pending migrations, then publishes with `wrangler deploy`, retrying up to 3 attempts
   with increasing delay.
6. Polls `/health` until the environment reports the released revision.
7. Appends a row to `docs/ops/deployment-log.csv` and, on success, tags `deploy/<env>/YYYYMMDD-HHMMSS`.

There is no automatic rollback. Exit code is 0 when released or already deployed, 1 otherwise.

Commit `docs/ops/deployment-log.csv` after releasing. It is the only file allowed to be uncommitted
when a release starts.

### First-time setup

```sh
bunx wrangler login
bunx wrangler d1 create todoodle-staging
bunx wrangler d1 create todoodle-production
```

Put the returned `database_id` values into `wrangler.toml` (`[env.staging]` and
`[env.production]`), and the environment base URLs into `scripts/deploy/constants.ts`
(`ENV_BASE_URLS`). Secrets are never stored in files in this repository; use `wrangler secret put`.

## Health

`GET /health` and `GET /api/health` return:

```json
{ "status": "ok", "environment": "staging", "version": "v1.2.0", "git_sha": "<40 hex>", "deployed_at": "<iso>" }
```

Locally: `environment: local`, `version: dev`, `git_sha: dev`, `deployed_at: null`.
