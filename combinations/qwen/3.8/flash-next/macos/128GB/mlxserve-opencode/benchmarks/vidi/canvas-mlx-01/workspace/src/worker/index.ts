/**
 * vidi6 entry Worker.
 *
 * Story 1 is entirely client-side, so this Worker does nothing but hand out the
 * built client: Cloudflare serves a static asset when the path matches one, and
 * everything else falls through to the single-page-application entry point.
 *
 * `wrangler.jsonc` binds the bucket `vidi6-backend` as the `BACKEND` namespace;
 * the types below are declared locally so the Worker does not need the DOM lib.
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  /** Asset binding declared in wrangler.jsonc (`binding: "ASSETS"`). */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** KV binding for the bucket `vidi6-backend` (`binding: "BACKEND"`). */
  BACKEND: KVNamespaceLike;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) {
      return asset;
    }
    // Unknown path: the SPA fallback comes from `not_found_handling` when Wrangler
    // can serve it, so this is the safety net for requests that reach the Worker.
    const indexUrl = new URL(request.url);
    indexUrl.pathname = '/index.html';
    if (url.pathname.startsWith('/assets/')) {
      // A missing hashed asset is a build problem, not a route to hide.
      return new Response('Not found', { status: 404 });
    }
    return env.ASSETS.fetch(new Request(indexUrl, { method: 'GET' }));
  },
} satisfies { fetch(request: Request, env: Env, ctx: unknown): Promise<Response> };
