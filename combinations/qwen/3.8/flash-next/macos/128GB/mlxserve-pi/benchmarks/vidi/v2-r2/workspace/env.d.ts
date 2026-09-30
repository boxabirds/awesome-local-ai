// The Worker's environment bindings. `@cloudflare/workers-types` declares an
// open `Cloudflare.Env` interface precisely so a project can merge its own
// bindings in here; `cloudflare:test`'s `env` / `SELF` are typed against it, so
// this is the single source of truth for the bindings in both `src/worker` and
// `tests/integration`. (See `npm run typecheck`, which compiles this file via
// tsconfig.worker.json.)
declare namespace Cloudflare {
  interface Env {
    BOARD_ROOM: DurableObjectNamespace<import('./src/worker/index').BoardRoom>;
    ASSETS: Fetcher;
  }
}
