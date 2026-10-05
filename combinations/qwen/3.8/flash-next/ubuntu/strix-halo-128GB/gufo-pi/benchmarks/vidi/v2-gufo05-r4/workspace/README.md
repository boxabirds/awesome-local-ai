# vidi6

A shared board for thinking together.

## Development

```sh
npm install
npm run dev         # client on http://127.0.0.1:21328
npm run build       # production client build in dist/client
npm run typecheck
npm test            # vitest unit + component suites
npm run test:e2e    # Playwright against `wrangler dev` on http://127.0.0.1:21330
```

Story 1 (pan and zoom around an infinite board) is implemented; see
`PROGRESS.md` for task status and `NOTES.md` for decisions, deviations and what
could not be verified on this machine.
