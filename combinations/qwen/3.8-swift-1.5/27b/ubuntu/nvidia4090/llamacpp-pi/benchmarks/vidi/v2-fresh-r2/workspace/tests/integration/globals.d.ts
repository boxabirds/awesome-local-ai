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
      get(id: string): DurableObjectStub;
    };
  };
  export function runInDurableObject<T>(
    stub: DurableObjectStub,
    callback: (instance: any) => T | Promise<T>,
  ): Promise<T>;
  export function evictDurableObject(
    stub: DurableObjectStub,
    options?: { deleteState?: boolean },
  ): Promise<void>;
}

interface DurableObjectStub {
  id: string;
  name: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Response {
  readonly webSocket?: WebSocket | null;
}
