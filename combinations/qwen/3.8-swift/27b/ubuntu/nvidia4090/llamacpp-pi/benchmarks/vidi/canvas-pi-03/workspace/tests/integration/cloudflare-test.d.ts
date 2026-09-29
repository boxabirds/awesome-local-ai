/**
 * Type declaration for the `cloudflare:test` module injected by
 * @cloudflare/vitest-pool-workers at runtime. `SELF` exposes the running
 * worker so tests can drive it end-to-end (e.g. the SPA fallback route).
 */
declare module 'cloudflare:test' {
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
}
