// Minimal Worker entry. Story 3 replaces this with the real collaboration
// Worker + Durable Object. For now it just hands requests to static assets;
// wrangler's `not_found_handling: single-page-application` serves index.html.
//
// Locally-typed to avoid pulling @cloudflare/workers-types into the client
// typecheck; story 3 will introduce proper worker typings.

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetFetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
