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
    /**
     * The board pictures. One object per image, under `<boardId>/<assetId>`, written once and
     * read for as long as the board lives: nothing here is ever overwritten, which is what lets
     * the asset route say `immutable` and mean it (story 12).
     */
    ASSETS_BUCKET: R2Bucket;
    /**
     * Set to `'1'` only in the e2e test environment. It turns on the room's
     * `/__test/...` storage hooks (see `src/worker/test-hooks.ts`); no production
     * configuration defines it, so those routes answer 404 there.
     */
    TEST_HOOKS?: string;
  }
}
