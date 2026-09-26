// Real WebSocket clients for the integration suite.
//
//   * rawClient  — a bare WebSocket with frame capture. Frame-level tests
//     (truncated frames, garbage bytes, awareness relay) speak the wire
//     directly and inspect exact bytes.
//   * yClient    — a real Y.Doc synced by y-websocket's WebsocketProvider
//     (the exact library the browser uses) against the workerd room, with
//     every frame captured through a logging WebSocket wrapper.
//
// Node's global WebSocket (undici) speaks the client side; the server side is
// the real BoardRoom Durable Object. No mocks anywhere in this stack.

import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { decodeMessage } from '../../../src/shared/protocol';
import { WS_ORIGIN } from './server';

export type CapturedFrame = { dir: 'in' | 'out'; bytes: Uint8Array };

/** Fresh unique room id: 16 random bytes rendered base64url WITHOUT padding —
 * exactly 22 characters, what the Worker's board-id validator accepts. */
export function room(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}


export interface RawClient {
  ws: WebSocket;
  /** Inbound binary frames (as exact bytes). */
  frames: Uint8Array[];
  closed: Promise<number>;
  close(): void;
}

/** Connect a raw WebSocket client to a room. Resolves once OPEN. */
export function rawClient(boardId: string, origin: string = WS_ORIGIN): Promise<RawClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin}/api/rooms/${boardId}`);
    ws.binaryType = 'arraybuffer';
    const frames: Uint8Array[] = [];
    let settleClosed: ((code: number) => void) | null = null;
    const closed = new Promise<number>((res) => {
      settleClosed = res;
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        frames.push(new Uint8Array(event.data as ArrayBuffer));
      }
    });
    ws.addEventListener('close', (event) => settleClosed?.(event.code));
    ws.addEventListener('error', (event) => reject(new Error(`ws error: ${(event as { message?: string }).message ?? 'unknown'}`)));
    ws.addEventListener('open', () => resolve({ ws, frames, closed, close: () => ws.close() }));
  });
}

/** Build a complete wire frame from a sync channel message type + content. */
export function syncFrame(syncType: number, content: Uint8Array): Uint8Array {
  const length = content.byteLength;
  const out: number[] = [0, syncType];
  // lib0 varUint length prefix.
  let len = length;
  for (; len >= 0x80; len >>>= 7) out.push((len & 0x7f) | 0x80);
  out.push(len);
  out.push(...content);
  return Uint8Array.from(out);
}

/** Build a complete wire frame from raw awareness update bytes. */
export function awarenessFrame(update: Uint8Array): Uint8Array {
  const length = update.byteLength;
  const out: number[] = [1];
  let len = length;
  for (; len >= 0x80; len >>>= 7) out.push((len & 0x7f) | 0x80);
  out.push(len);
  out.push(...update);
  return Uint8Array.from(out);
}

export function framesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when `frame` is a sync UPDATE (channel 0, type 2) carrying `update`
 * bytes: the shape the room relays after applying a doc update. */
export function isUpdateFrame(frame: Uint8Array): boolean {
  const decoded = decodeMessage(frame);
  return decoded.kind === 'sync' && decoded.payload[0] === 2;
}

export interface YClient {
  doc: Y.Doc;
  provider: InstanceType<typeof WebsocketProvider>;
  /** Every frame through this client's socket (both directions), appended in
   * arrival order by the logging wrapper. */
  frames: CapturedFrame[];
  status: Array<'connecting' | 'connected' | 'disconnected'>;
  destroy(): void;
}

/**
 * Create a REAL y-websocket provider against the workerd room, wrapping the
 * provider's WebSocket with a logging subclass so tests can assert on exact
 * frame bytes (echo rules, awareness relay, etc).
 */
export function yClient(
  boardId: string,
  doc?: Y.Doc,
  opts: { connect?: boolean; resyncInterval?: number; origin?: string; impl?: typeof WebSocket } = {},
): YClient {
  const doc0 = doc ?? new Y.Doc();
  const frames: CapturedFrame[] = [];
  const LoggingWebSocket = class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          frames.push({ dir: 'in', bytes: new TextEncoder().encode(event.data) });
        } else {
          frames.push({ dir: 'in', bytes: new Uint8Array(event.data as ArrayBuffer) });
        }
      });
    }
    override send(data: Parameters<WebSocket['send']>[0]): void {
      const bytes =
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : data instanceof Uint8Array
            ? data.slice()
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array((data as ArrayBufferView).buffer.slice((data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteOffset + (data as ArrayBufferView).byteLength));
      frames.push({ dir: 'out', bytes });
      super.send(data);
    }
  };
  const status: YClient['status'] = [];
  const provider = new WebsocketProvider(`${opts.origin ?? WS_ORIGIN}/api/rooms`, boardId, doc0, {
    connect: opts.connect ?? true,
    disableBc: true,
    maxBackoffTime: 10_000,
    resyncInterval: opts.resyncInterval ?? 20_000,
    WebSocketPolyfill: opts.impl ?? (LoggingWebSocket as unknown as typeof WebSocket),
  });
  provider.on('status', (...args: unknown[]) => {
    // y-websocket emits `[{ status }, provider]`.
    const first = args[0] as Array<{ status: string }> | { status: string };
    const entry = Array.isArray(first) ? first[0] : first;
    if (entry) status.push(entry.status as 'connecting' | 'connected' | 'disconnected');
  });
  return {
    doc: doc0,
    provider,
    frames,
    status,
    destroy() {
      provider.destroy();
    },
  };
}

/** Wait until `predicate` holds or timeout. Returns true if satisfied. */
export async function until(
  predicate: () => boolean,
  timeoutMs = 8_000,
  intervalMs = 15,
): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return true;
}

/** Wait for two docs to agree on the text of Y.Text `key` inside Y.Map
 * `objects` id `id` (or any shared nested path via the getter). */
export function textOf(doc: Y.Doc, id: string): string | null {
  const obj = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!obj) return null;
  const text = obj.get('text');
  return text instanceof Y.Text ? text.toString() : null;
}