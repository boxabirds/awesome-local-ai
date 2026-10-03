/**
 * Types for the Cloudflare workers test pool.
 *
 * In this workerd generation `SELF`/`env` are NOT injected as globals in the
 * test module scope; the pool exposes them (plus helpers) via the
 * `cloudflare:test` module, which the cloudflareTest plugin maps to its
 * runner shim.
 */

declare module 'cloudflare:test' {
  export const SELF: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  export const env: {
    BOARD_ROOM: {
      idFromName(name: string): string;
      get(id: string): { fetch(req: Request): Promise<Response> };
    };
  };
}

interface Response {
  readonly webSocket?: WebSocket | null;
}
