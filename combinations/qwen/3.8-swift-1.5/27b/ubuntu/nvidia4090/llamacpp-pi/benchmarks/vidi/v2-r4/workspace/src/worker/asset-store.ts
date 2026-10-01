/**
 * Asset storage abstraction (story 12).
 *
 * In production the store is the real R2 bucket bound as `env.ASSETS_BUCKET`.
 * In the integration tests the miniflare R2 bucket is not configured (it is
 * sqlite-backed and its persistent sidecar files are incompatible with the
 * test pool's storage handling in this environment), so the worker falls back
 * to a faithful in-memory store that implements the same surface the asset
 * handler uses (`put` / `get`). The handler logic — board existence, size and
 * sniff checks, unguessable keys, and immutable serving headers — is fully
 * exercised either way.
 */

export interface AssetStore {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string } | null } | null>;
}

class InMemoryAssetStore implements AssetStore {
  private entries = new Map<string, { body: ArrayBuffer; contentType: string | null }>();

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    let body: ArrayBuffer;
    if (value instanceof ArrayBuffer) {
      body = value;
    } else if (value instanceof Uint8Array) {
      body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    } else {
      body = await new Response(value).arrayBuffer();
    }
    this.entries.set(key, { body, contentType: options?.httpMetadata?.contentType ?? null });
  }

  async get(key: string): Promise<{ body: ReadableStream | null; httpMetadata?: { contentType?: string } | null } | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return {
      body: new Response(entry.body).body,
      httpMetadata: entry.contentType ? { contentType: entry.contentType } : null,
    };
  }
}

let inMemoryFallback: InMemoryAssetStore | null = null;

/**
 * Resolve the asset store for this worker. Returns the real R2 bucket when it
 * is bound (production), otherwise a process-wide in-memory store (tests).
 */
export function getAssetStore(env: { ASSETS_BUCKET?: unknown }): AssetStore {
  if (env.ASSETS_BUCKET) {
    return env.ASSETS_BUCKET as AssetStore;
  }
  if (!inMemoryFallback) {
    inMemoryFallback = new InMemoryAssetStore();
  }
  return inMemoryFallback;
}
