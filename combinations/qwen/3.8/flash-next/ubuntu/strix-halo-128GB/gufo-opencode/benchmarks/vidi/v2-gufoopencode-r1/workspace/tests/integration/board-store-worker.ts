import * as Y from 'yjs';
import { DurableObject } from 'cloudflare:workers';
import { BoardStore, type BoardStorage } from '../../src/worker/board-store';

// Test-only Worker exposing a raw BoardStore inside a real Durable Object so
// the integration tests can drive migrate/append/load/compact against actual
// SQLite-backed DO storage and inject faults. Not part of the app.

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(binary);
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type BoundValue = string | number | null | Uint8Array;

class FaultStorage implements BoardStorage {
  constructor(
    private readonly inner: DurableObjectStorage,
    private readonly mode: string
  ) {}

  readonly sql = {
    exec: (query: string, ...params: BoundValue[]) => {
      const result = this.inner.sql.exec(query, ...params);
      if (this.mode === 'after-chunk-delete' && query.startsWith('DELETE FROM snapshot_chunks')) {
        throw new Error('injected compaction failure');
      }
      return result;
    }
  };

  transactionSync<T>(fn: () => T): T {
    return this.inner.transactionSync(fn);
  }
}

type Env = Record<string, never>;

export class BoardStoreTestRoom extends DurableObject<Env> {
  private store: BoardStore | null = null;

  private getStore(): BoardStore {
    if (this.store === null) this.store = new BoardStore(this.ctx.storage);
    return this.store;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.replace(/^\/+/, '');
    const store = this.getStore();
    switch (action) {
      case 'migrate':
        store.migrate();
        return Response.json({ ok: true });
      case 'append': {
        const bytes = new Uint8Array(await request.arrayBuffer());
        store.append(bytes);
        return Response.json({ ok: true });
      }
      case 'load': {
        const doc = new Y.Doc();
        const result = store.load(doc);
        if (!result.ok) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'x-load-ok': '0', 'content-type': 'application/json' }
          });
        }
        const encoded = Y.encodeStateAsUpdate(doc);
        return new Response(encoded as unknown as BodyInit, {
          headers: { 'x-load-ok': '1', 'x-quarantined': String(result.quarantined) }
        });
      }
      case 'compact': {
        const doc = this.stateForCompaction();
        const done = url.searchParams.get('force') === '1' ? store.compact(doc) : store.compactIfNeeded(doc);
        return Response.json({ done });
      }
      case 'compact-fault': {
        const doc = this.stateForCompaction();
        const faulty = new BoardStore(
          new FaultStorage(this.ctx.storage, url.searchParams.get('mode') ?? 'after-chunk-delete')
        );
        const done = faulty.compact(doc);
        return Response.json({ done });
      }
      case 'raw': {
        const body = (await request.json()) as { query: string; params?: unknown[] };
        const bound = (body.params ?? []).map((value) =>
          typeof value === 'string' && value.startsWith('b64:') ? decodeBase64(value.slice(4)) : (value as BoundValue)
        );
        const rows = this.ctx.storage.sql.exec(body.query, ...bound).toArray();
        return Response.json({
          rows: rows.map((row) => {
            const out: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) {
              out[key] = value instanceof ArrayBuffer ? encodeBase64(new Uint8Array(value)) : value;
            }
            return out;
          })
        });
      }
      case 'stats':
        return Response.json(store.stats());
      default:
        return new Response('unknown action', { status: 404 });
    }
  }

  // Load the current stored state into a fresh doc for compaction.
  private stateForCompaction(): Y.Doc {
    const doc = new Y.Doc();
    const result = this.getStore().load(doc);
    if (!result.ok) throw new Error(`cannot compact an unloadable board: ${result.reason}`);
    return doc;
  }
}

export default {
  async fetch(request: Request, env: { STORE: DurableObjectNamespace }): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get('id');
    if (name === null) return new Response('missing ?id=', { status: 400 });
    const ns = env.STORE;
    const stub = ns.get(ns.idFromName(name));
    return stub.fetch(new Request(`https://store${url.pathname}${url.search}`, request));
  }
};
