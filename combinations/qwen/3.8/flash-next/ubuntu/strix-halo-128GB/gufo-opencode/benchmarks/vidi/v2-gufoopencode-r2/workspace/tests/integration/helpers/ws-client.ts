// Real Y.Doc + y-protocols WebSocket client for workerd integration tests.
// Frames are byte-identical to what y-websocket exchanges, so the BoardRoom
// under test sees exactly what a browser provider would send.

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, SELF } from 'cloudflare:test';
import { createSticky, snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { decodeMessage, MESSAGE_SYNC } from '../../../src/shared/protocol';

/** Create a board through the real HTTP API (story 5): POST /api/boards. */
export async function createBoard(): Promise<string> {
  const response = await SELF.fetch('http://mocked-worker/api/boards', { method: 'POST' });
  if (response.status !== 201) {
    throw new Error(`POST /api/boards failed with ${response.status}`);
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

/** Create a board directly via DO RPC (bypasses the HTTP layer). */
export async function createBoardRpc(boardId: string): Promise<'created' | 'exists'> {
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  return (stub as unknown as { initialize(): Promise<'created' | 'exists'> }).initialize();
}

export interface ReceivedFrame {
  kind: 'sync' | 'awareness' | 'query-awareness';
  syncId: number | null;
  bytes: Uint8Array;
}

const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

export class TestClient {
  readonly received: ReceivedFrame[] = [];
  /** When true, local updates are collected instead of sent (pause/resume). */
  private paused = false;
  private pending: Uint8Array[] = [];
  private ws: WebSocket | null = null;
  private closedResolver: ((code: number) => void) | null = null;

  private constructor(
    readonly doc: Y.Doc,
    readonly boardId: string,
  ) {}

  static async connect(boardId: string, doc: Y.Doc = new Y.Doc()): Promise<TestClient> {
    const client = new TestClient(doc, boardId);
    const response = await SELF.fetch(`http://mocked-worker/api/rooms/${boardId}`, {
      headers: { upgrade: 'websocket', connection: 'Upgrade' },
    });
    const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
    if (!ws) throw new Error(`no WebSocket in response (status ${response.status})`);
    // The test-side socket of a SELF.fetch upgrade must be accepted too.
    ws.accept();
    client.ws = ws;

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (client.paused) {
        client.pending.push(update);
        return;
      }
      client.sendSyncUpdate(update);
    });

    ws.addEventListener('message', (event) => {
      const raw = event.data as ArrayBuffer;
      const data = new Uint8Array(raw);
      const decoded = decodeMessage(raw);
      if (decoded.kind === 'sync') {
        client.received.push({ kind: 'sync', syncId: decoded.payload[0], bytes: data });
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(
          decoding.createDecoder(data.subarray(1)),
          reply,
          client.doc,
          'remote',
        );
        if (encoding.length(reply) > 1) client.sendRaw(encoding.toUint8Array(reply));
      } else if (decoded.kind !== 'invalid') {
        client.received.push({ kind: decoded.kind, syncId: null, bytes: data });
      }
    });
    ws.addEventListener('close', (event) => {
      const code = (event as CloseEvent).code;
      client.closedResolver?.(code);
      client.closedResolver = null;
    });

    // Kick off the handshake; the room also sends its own SyncStep1 on accept.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    client.sendRaw(encoding.toUint8Array(enc));
    await client.waitForSynced();
    return client;
  }

  /** Wait for the room's answer (SyncStep2) to our initial SyncStep1. */
  private async waitForSynced(): Promise<void> {
    await this.waitFor(() =>
      this.received.some((f) => f.kind === 'sync' && f.syncId === SYNC_STEP2),
    );
  }

  private sendSyncUpdate(update: Uint8Array): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.sendRaw(encoding.toUint8Array(enc));
  }

  sendRaw(data: Uint8Array | string): void {
    if (this.ws === null) throw new Error('client not connected');
    this.ws.send(data);
  }

  /** Run a local mutation as a local transaction (goes to the room unless paused). */
  local(fn: () => void): void {
    Y.transact(this.doc, fn, 'local');
  }

  /** Stop sending local updates; they queue until resumeAndFlush(). */
  pause(): void {
    this.pending = [];
    this.paused = true;
  }

  resumeAndFlush(): void {
    this.paused = false;
    const queued = this.pending;
    this.pending = [];
    for (const update of queued) this.sendSyncUpdate(update);
  }

  /** Count SyncUpdate frames received since connect (echo/broadcast checks). */
  updateCount(): number {
    return this.received.filter((f) => f.kind === 'sync' && f.syncId === SYNC_UPDATE).length;
  }

  snapshot(): readonly StickySnapshot[] {
    return snapshot(this.doc);
  }

  async waitFor(
    condition: () => boolean,
    timeoutMs = 10_000,
    message = 'condition',
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Resolves with the close code the room sends (TC-15). */
  waitForClose(timeoutMs = 10_000): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket did not close')), timeoutMs);
      this.closedResolver = (code) => {
        clearTimeout(timer);
        resolve(code);
      };
    });
  }

  close(): void {
    this.ws?.close();
  }

  /**
   * Wait until a client-initiated close() has been handed off. workerd
   * neither delivers a close event for self-initiated closes nor reaches
   * CLOSED (the pair is in-process, the peer ack is not observable here),
   * so leave as soon as the socket is no longer OPEN.
   */
  async waitForClosed(timeoutMs = 10_000): Promise<void> {
    await this.waitFor(
      () => this.ws !== null && this.ws.readyState !== WebSocket.OPEN,
      timeoutMs,
      'socket to leave OPEN',
    );
  }

  destroy(): void {
    this.ws?.close();
    this.doc.destroy();
  }
}

export function snapshotString(client: TestClient): string {
  return JSON.stringify(client.snapshot());
}

/** Create a sticky note in one local transaction; returns its id. */
export function createNote(client: TestClient, x: number, y: number): string {
  let id = '';
  client.local(() => {
    id = createSticky(client.doc, { x, y }) as string;
  });
  return id;
}
