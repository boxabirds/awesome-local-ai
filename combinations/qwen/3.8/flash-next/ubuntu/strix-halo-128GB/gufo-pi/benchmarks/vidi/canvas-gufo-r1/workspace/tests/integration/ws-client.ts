import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../src/shared/protocol';

export interface WsClient {
  doc: Y.Doc;
  ws: WebSocket;
  receivedMessages: ArrayBuffer[];
  waitForSync(timeout?: number): Promise<void>;
  snapshot(): readonly StickySnapshot[];
  close(): void;
}

/**
 * Connect a real Y.Doc via WebSocket to the BoardRoom via SELF.fetch.
 * Speaks the same y-websocket framing as the browser provider.
 * Automatically forwards local doc updates to the server as sync Protocol updates.
 */
export async function createWsClient(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  boardId: string,
): Promise<WsClient> {
  const doc = new Y.Doc();
  initDoc(doc);

  const response = await fetchFn(`http://example.com/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });

  if (response.status !== 101 || !response.webSocket) {
    throw new Error(`Failed to connect: status=${response.status}, ws=${!!response.webSocket}`);
  }

  const ws = response.webSocket;
  ws.accept();

  const receivedMessages: ArrayBuffer[] = [];
  let syncComplete = false;
  let applyingRemote = false;

  ws.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ArrayBuffer;
    receivedMessages.push(data);
    handleIncoming(data);
  });

  ws.addEventListener('close', () => {
    // server closed connection
  });

  function handleIncoming(data: ArrayBuffer) {
    const bytes = new Uint8Array(data);
    if (bytes.length === 0) return;
    const msgType = bytes[0]!;
    const payload = bytes.slice(1);

    if (msgType === MESSAGE_SYNC) {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      applyingRemote = true;
      const syncMsgType = syncProtocol.readSyncMessage(decoder, encoder, doc, null);
      applyingRemote = false;
      // Send reply if non-empty
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      // Once we receive SyncStep2, sync is complete
      if (syncMsgType === syncProtocol.messageYjsSyncStep2) {
        syncComplete = true;
      }
    }
  }

  // Forward local updates to the server as syncProtocol Update messages
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    // Don't send back updates that came from the server
    if (applyingRemote) return;
    // Only send after initial sync (before sync we're doing the initial exchange)
    if (!syncComplete) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encoding.toUint8Array(encoder));
    }
  });

  // Send SyncStep1 to request any state the server has that we don't
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));

  async function waitForSync(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (!syncComplete) {
      if (Date.now() - start > timeout) {
        throw new Error('Timeout waiting for sync');
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  return {
    doc,
    ws,
    receivedMessages,
    waitForSync,
    snapshot: () => snapshot(doc),
    close: () => ws.close(),
  };
}

/**
 * Send a raw frame with the given message type byte and payload.
 */
export function sendRaw(ws: WebSocket, type: number, payload?: Uint8Array): void {
  if (payload) {
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = type;
    frame.set(payload, 1);
    ws.send(frame);
  } else {
    const frame = new Uint8Array(1);
    frame[0] = type;
    ws.send(frame);
  }
}
