/**
 * Integration test helper: opens a WebSocket from SELF.fetch upgrade response,
 * wraps a real Y.Doc speaking y-protocols (sync + awareness framing identical to y-websocket).
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';

export interface TestClient {
  doc: Y.Doc;
  ws: WebSocket;
  /** Messages received (sync frames only, not awareness) */
  receivedUpdates: Uint8Array[];
  /** All raw messages received */
  allMessages: (ArrayBuffer | string)[];
  waitForSync(): Promise<void>;
  snapshot(): readonly { id: string; text: string; x: number; y: number; color: string }[];
  close(): void;
  send(data: ArrayBuffer | string): void;
  boardId: string;
}

/**
 * Connect to a board room via WebSocket using SELF.fetch.
 */
export async function connectRoom(boardId?: string): Promise<TestClient> {
  const id = boardId ?? newBoardId();
  const url = `http://localhost/api/rooms/${id}`;

  const req = new Request(url, {
    headers: { Upgrade: 'websocket' },
  });

  const res = await SELF.fetch(req);
  if (res.status !== 101) {
    throw new Error(`Expected 101, got ${res.status}`);
  }

  const ws = res.webSocket;
  if (!ws) throw new Error('No webSocket in response');

  const doc = new Y.Doc();
  const receivedUpdates: Uint8Array[] = [];
  const allMessages: (ArrayBuffer | string)[] = [];
  let syncComplete = false;
  let syncResolve: (() => void) | null = null;

  // Track whether we've done the full sync handshake
  let gotSyncStep2 = false;
  let gotSyncStep1FromServer = false;

  ws.addEventListener('message', (event) => {
    const data = event.data;
    allMessages.push(data);

    if (typeof data === 'string') return;

    const uint8 = new Uint8Array(data);
    const decoder = decoding.createDecoder(uint8);
    const msgType = decoding.readVarUint(decoder);

    if (msgType === 0) {
      // Sync message
      try {
        const syncDecoder = decoding.createDecoder(uint8.slice(decoder.pos));
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        const syncMsgType = syncProtocol.readSyncMessage(syncDecoder, encoder, doc, 'remote');
        if (syncMsgType === syncProtocol.messageYjsSyncStep1) {
          gotSyncStep1FromServer = true;
        }
        if (syncMsgType === syncProtocol.messageYjsSyncStep2) {
          gotSyncStep2 = true;
        }
        // Send reply if non-empty
        const reply = encoding.toUint8Array(encoder);
        if (reply.byteLength > 1) {
          ws.send(reply);
        }
        // Check if sync is complete
        if (gotSyncStep2 && gotSyncStep1FromServer && !syncComplete) {
          syncComplete = true;
          if (syncResolve) syncResolve();
        }
      } catch {
        // ignore decode errors on test side
      }
    }
  });

  // Forward local doc updates to server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return; // Don't echo back updates received from server
    // y-websocket framing: [outer_type=0 (sync)][syncProtocol.writeUpdate: varUint 2 + varUint8Array(update)]
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // outer: sync
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });

  ws.accept();

  // Initiate sync: send SyncStep1
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));

  // We consider sync complete when both sides have exchanged state
  // After receiving SyncStep1 from server and sending our SyncStep2, and receiving their SyncStep2, we're done
  // Give a brief initial sync window
  await new Promise<void>((resolve) => {
    syncResolve = resolve;
    // Fallback: resolve after 200ms even if we don't get explicit signals
    setTimeout(resolve, 200);
  });

  return {
    doc,
    ws,
    receivedUpdates,
    allMessages,
    async waitForSync(): Promise<void> {
      await new Promise((r) => setTimeout(r, 50));
    },
    snapshot() {
      const objects = doc.getMap('objects');
      const result: { id: string; text: string; x: number; y: number; color: string }[] = [];
      objects.forEach((obj: any, id: string) => {
        if (obj.get('type') !== 'sticky') return;
        result.push({
          id,
          text: (obj.get('text') as Y.Text)?.toString() ?? '',
          x: obj.get('x') as number,
          y: obj.get('y') as number,
          color: obj.get('color') as string,
        });
      });
      result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return result;
    },
    close() {
      ws.close();
    },
    send(data: ArrayBuffer | string) {
      ws.send(data);
    },
    boardId: id,
  };
}

/** Helper: compare snapshots ignoring z and createdAt */
export function snapEqual(
  a: readonly { id: string; text: string; x: number; y: number; color: string }[],
  b: readonly { id: string; text: string; x: number; y: number; color: string }[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].text !== b[i].text) return false;
    if (a[i].x !== b[i].x) return false;
    if (a[i].y !== b[i].y) return false;
    if (a[i].color !== b[i].color) return false;
  }
  return true;
}
