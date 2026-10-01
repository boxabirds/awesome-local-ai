# Platform foundation

A single Cloudflare Worker serves both the API (Hono, D1, Durable Objects) and the React/Vite/shadcn SPA as static assets; it is not on Pages. Bun handles tooling and tests run under vitest and Playwright. Stories in build order:
1. See which version of Todoodle is live in each environment: request pipeline, health, multi-environment deploy with safety checks, test-route registry and test matrix.
10. Keep my workspace responsive when someone tries to overload Todoodle: rate limits, the single 429 contract, and the 'try again in…' experience. It extends stories 1, 2, 4, 5, 6 and 9.

**Position:** 1 of 3

## Stories

| # | ID | Title | Status |
|---|----|-------|--------|
| 1 | 1 | See which version of Todoodle is live in each environment | proposed |
| 2 | 10 | Keep my workspace responsive when someone tries to overload Todoodle, and get a clear 'try again in…' when I'm going too fast | proposed |

