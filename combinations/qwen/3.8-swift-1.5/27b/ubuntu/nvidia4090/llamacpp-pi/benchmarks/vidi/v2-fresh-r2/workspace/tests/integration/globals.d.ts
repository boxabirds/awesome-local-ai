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
    /** Story 12: image assets (R2). */
    ASSETS_BUCKET: R2BucketLike;
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

interface R2BucketLike {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(
    key: string,
    options?: unknown,
  ): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
  list(options?: unknown): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

interface Response {
  readonly webSocket?: WebSocket | null;
}
