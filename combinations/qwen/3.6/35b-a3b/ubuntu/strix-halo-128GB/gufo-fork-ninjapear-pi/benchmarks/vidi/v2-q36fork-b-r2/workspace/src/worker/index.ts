// Minimal Cloudflare Worker entry point — assets are served directly by Wrangler.
export default {
  async fetch(request: Request): Promise<Response> {
    // Cloudflare Workers runtime provides ASSETS binding automatically.
    const env = globalThis as unknown as { ASSETS?: { fetch: (r: Request) => Response | Promise<Response> } };
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Assets not configured', { status: 500 });
  },
};
