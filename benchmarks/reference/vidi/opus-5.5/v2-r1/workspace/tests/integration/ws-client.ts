// A real Y.Doc speaking the y-websocket protocol over a real WebSocket to the Worker,
// with the same framing as the browser's WebsocketProvider.
import { SELF } from 'cloudflare:test';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import {
  decodeMessage,
  encodeSyncStep1,
  encodeUpdate,
  readSync,
} from '../../src/shared/protocol';

const REMOTE = Symbol('remote');
const DEFAULT_TIMEOUT_MS = 5000;

export function roomUrl(boardId: string): string {
  return `http://example.com/api/rooms/${boardId}`;
}

/** Creates a board through the real API (POST /api/boards) and returns its id. */
export async function createBoardId(): Promise<string> {
  const res = await SELF.fetch('http://example.com/api/boards', { method: 'POST' });
  if (res.status !== 201) throw new Error(`POST /api/boards answered ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

export async function openSocket(boardId: string): Promise<{ status: number; ws: WebSocket }> {
  const res = await SELF.fetch(roomUrl(boardId), { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no WebSocket in response (status ${res.status})`);
  ws.accept();
  ws.binaryType = 'arraybuffer';
  return { status: res.status, ws };
}

/** Polls `cond` until it holds; throws with `label` after `timeoutMs`. */
export async function waitFor(
  cond: () => boolean,
  label = 'condition',
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function syncTypeOf(frame: Uint8Array): number | null {
  const decoded = decodeMessage(frame);
  if (decoded.kind !== 'sync') return null;
  return decoding.readVarUint(decoding.createDecoder(decoded.payload));
}

export class TestClient {
  readonly doc: Y.Doc;
  /** Every binary frame received, in order. */
  readonly received: Uint8Array[] = [];
  closeCode: number | null = null;
  private synced = false;
  private readonly onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE && this.isOpen) this.ws.send(encodeUpdate(update));
  };

  private constructor(
    readonly ws: WebSocket,
    readonly status: number,
    doc: Y.Doc,
  ) {
    this.doc = doc;
    ws.addEventListener('message', (e) => {
      if (typeof e.data === 'string') return;
      const frame = new Uint8Array(e.data as ArrayBuffer);
      this.received.push(frame);
      const decoded = decodeMessage(frame);
      if (decoded.kind !== 'sync') return;
      if (syncTypeOf(frame) === syncProtocol.messageYjsSyncStep2) this.synced = true;
      const reply = readSync(this.doc, decoded.payload, REMOTE);
      if (reply && this.isOpen) ws.send(reply);
    });
    ws.addEventListener('close', (e) => {
      this.closeCode = e.code;
    });
    doc.on('update', this.onLocalUpdate);
    // Like y-websocket: announce our state vector; the room answers with what we lack.
    ws.send(encodeSyncStep1(doc));
  }

  /** Connects a client (optionally with an existing doc) and waits for the initial sync. */
  static async connect(boardId: string, doc = new Y.Doc()): Promise<TestClient> {
    const { ws, status } = await openSocket(boardId);
    const client = new TestClient(ws, status, doc);
    await client.waitForSync();
    return client;
  }

  get isOpen(): boolean {
    return this.closeCode === null && this.ws.readyState === WebSocket.OPEN;
  }

  waitForSync(): Promise<void> {
    return waitFor(() => this.synced, 'initial sync');
  }

  /** Received document update messages (not sync steps or awareness). */
  get updatesReceived(): number {
    return this.received.filter((f) => syncTypeOf(f) === syncProtocol.messageYjsUpdate).length;
  }

  snapshot() {
    return snapshot(this.doc);
  }

  /**
   * Round trip through the room: every message the room sent before answering this probe has
   * been received once it resolves (a WebSocket delivers in order).
   */
  async roundTrip(): Promise<void> {
    const before = this.received.length;
    const probe = new Y.Doc();
    this.ws.send(encodeSyncStep1(probe));
    await waitFor(
      () =>
        this.received
          .slice(before)
          .some((f) => syncTypeOf(f) === syncProtocol.messageYjsSyncStep2),
      'round trip',
    );
  }

  close(code = 1000): void {
    this.doc.off('update', this.onLocalUpdate);
    try {
      this.ws.close(code);
    } catch {
      // Already closed.
    }
  }
}
