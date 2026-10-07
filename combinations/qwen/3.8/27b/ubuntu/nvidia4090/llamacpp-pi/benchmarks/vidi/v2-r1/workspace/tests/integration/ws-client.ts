// Integration test helper: a minimal y-websocket client for workerd integration tests.
// Uses SELF.fetch to get the 101 response with the client-side WebSocket, then
// speaks y-protocols (sync) over it.
//
// IMPORTANT: This client does NOT set meta.schemaVersion locally. The meta is
// expected to come from the server/other clients via sync. This avoids the
// Yjs state vector conflict that occurs when two clients independently set
// the same key with different client IDs.

import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SELF } from 'cloudflare:test';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface WsClient {
  /** The client-side WebSocket from the 101 response. */
  ws: WebSocket;
  /** The Y.Doc backing this client. */
  doc: Y.Doc;
  /** Wait until initial sync is complete. */
  waitForSync(): Promise<void>;
  /** Current document state. */
  snapshot(): { count: number; notes: Array<{ id: string; x: number; y: number; text: string; color: string }> };
  /** Received update payloads (for echo detection). */
  receivedUpdates: Uint8Array[];
  /** Received awareness payloads. */
  receivedAwareness: Uint8Array[];
  /** Resolves when the socket closes. */
  closed: Promise<{ code: number }>;
  /** Close the socket. */
  close(): void;
}

function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
}

/**
 * Create a WebSocket client that connects to a board room via SELF.fetch.
 * The client sends its local doc updates to the server and applies remote updates.
 */
export async function createWsClient(boardId: string): Promise<WsClient> {
  const doc = new Y.Doc();

  const receivedUpdates: Uint8Array[] = [];
  const receivedAwareness: Uint8Array[] = [];

  let syncResolve: (() => void) | null = null;
  const synced = new Promise<void>((r) => { syncResolve = r; });

  let closedResolve: ((r: { code: number }) => void) | null = null;
  const closed = new Promise<{ code: number }>((r) => { closedResolve = r; });

  // Get the client-side WebSocket via SELF.fetch
  const response = await SELF.fetch(
    `http://127.0.0.1/api/rooms/${boardId}`,
    { headers: { Upgrade: 'websocket', 'Connection': 'Upgrade' } },
  );

  if (response.status !== 101) {
    throw new Error(`Expected 101, got ${response.status}: ${await response.text()}`);
  }

  const ws = response.webSocket!;
  ws.accept(); // Required in workerd test environment
  ws.binaryType = 'arraybuffer';

  let firstSyncMessageProcessed = false;

  function sendLocalUpdate(update: Uint8Array) {
    if (ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  }

  // Listen for local doc updates and send them to the server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    sendLocalUpdate(update);
  });

  function handleMessage(event: MessageEvent) {
    const data = event.data as ArrayBuffer;
    const bytes = new Uint8Array(data);
    const dec = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(dec);

    if (type === MESSAGE_SYNC) {
      const resEnc = encoding.createEncoder();
      const msgType = sync.readSyncMessage(dec, resEnc, doc, 'remote');

      if (msgType === 2) {
        // Received an update from server
        const updateStart = dec.pos;
        receivedUpdates.push(bytes.slice(updateStart));
      }

      if (encoding.length(resEnc) > 0) {
        ws.send(encoding.toUint8Array(resEnc));
      }

      // Mark as synced after first sync message processed
      if (!firstSyncMessageProcessed) {
        firstSyncMessageProcessed = true;
        setTimeout(() => {
          if (syncResolve) syncResolve();
        }, 50);
      }
    } else if (type === MESSAGE_AWARENESS) {
      receivedAwareness.push(bytes.slice(dec.pos));
    }
  }

  // Set up message handler
  ws.onmessage = handleMessage;

  ws.onclose = (event: CloseEvent) => {
    if (closedResolve) closedResolve({ code: event.code });
  };

  // Send our SyncStep1 (we're already open)
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  sync.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));

  return {
    ws,
    doc,
    waitForSync: () => synced,
    snapshot: () => {
      const objects = getObjectsMap(doc);
      const notes: Array<{ id: string; x: number; y: number; text: string; color: string }> = [];
      objects.forEach((obj, id) => {
        const x = obj.get('x');
        const y = obj.get('y');
        const color = obj.get('color');
        const text = obj.get('text');
        notes.push({
          id,
          x: typeof x === 'number' ? x : 0,
          y: typeof y === 'number' ? y : 0,
          color: typeof color === 'string' ? color : '',
          text: text instanceof Y.Text ? text.toString() : '',
        });
      });
      return { count: notes.length, notes };
    },
    receivedUpdates,
    receivedAwareness,
    closed,
    close: () => ws.close(),
  };
}
