# vidi6

A shared board for thinking together.

## Development

```sh
npm install
npm run dev         # client on http://127.0.0.1:21328
npm run build       # production client build in dist/client
npm run typecheck
npm test            # vitest: unit, component, and workerd integration suites
npm run test:e2e    # Playwright against `wrangler dev` on http://127.0.0.1:21330
npm run test:e2e:nightly  # the slow runs: idle connection stability, capacity soak
```

Stories 1 to 3 are implemented: an infinite board you can pan and zoom, with sticky
notes that capture ideas — double-click or use the note tool to make one, type into
it, drag it where it belongs, change its colour, delete it — and the same board live:
open a board's address (`/b/<board-id>`) in another window, or on another machine,
and every note, word and move appears there as it happens. Nothing is saved yet; that
is story 4. See `PROGRESS.md` for task status and `NOTES.md` for decisions, deviations
and what could not be verified on this machine.
