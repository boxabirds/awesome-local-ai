// Binds the wrangler.jsonc bindings to the Cloudflare.Env global so the
// pool-provided `env` is typed. Must stay a global script (no top-level
// import/export) for the augmentation to apply.
declare namespace Cloudflare {
  interface Env {
    BOARD_ROOM: DurableObjectNamespace;
    ASSETS: Fetcher;
  }
}
