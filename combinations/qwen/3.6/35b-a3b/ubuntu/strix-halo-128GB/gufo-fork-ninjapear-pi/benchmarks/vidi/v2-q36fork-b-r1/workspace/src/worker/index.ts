// Cloudflare Worker - serves static assets from dist/client
// In this story, only the asset serving is needed; actual server code arrives in story 3.
export default {
  fetch(request: Request): Response {
    // Defer to Cloudflare's built-in asset serving via wrangler.jsonc assets configuration.
    return new Response('Not implemented', { status: 501 });
  },
};
