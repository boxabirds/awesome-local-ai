import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../src/shared/protocol';

export interface TestClient {
  ws: WebSocket;
  doc: Y.Doc;
  receivedMessages: Uint8Array[];
  closeCode: number | null;
  waitForSync: () => Promise<void>;
  snapshot: () => Y.Doc;
  destroy: () => void;
}

/**
 * Creates a test WebSocket client that speaks y-protocols framing,
 * identical to what y-websocket does in the browser.
 */
export async function createTestClient(url: string, boardId: string): Promise<TestClient> {
  const doc = new Y.Doc();
  const wsUrl = url.replace('http', 'ws') + `/api/rooms/${boardId}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  const receivedMessages: Uint8Array[] = [];
  let closeCode: number | null = null;

  // Wait for open
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`WebSocket error connecting to ${wsUrl}`));
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
  });

  let synced = false;
  let syncResolveFn: () => void = () => {};
  const syncPromise = new Promise<void>((resolve) => { syncResolveFn = resolve; });

  ws.onmessage = (event: MessageEvent) => {
    const data = event.data as ArrayBuffer;
    receivedMessages.push(new Uint8Array(data));

    const bytes = new Uint8Array(data);
    if (bytes.length < 1) return;
    const type = bytes[0];

    if (type === MESSAGE_SYNC) {
      const decoder = decoding.createDecoder(bytes);
      decoding.readUint8(decoder); // skip type
      const payload = decoding.readVarUint8Array(decoder);

      const msgDecoder = decoding.createDecoder(payload);
      const syncMessageType = decoding.readUint8(msgDecoder);

      if (syncMessageType === 0) {
        // SyncStep1 from server
        decoding.readVarUint8Array(msgDecoder); // consume server state vector

        // Reply with our SyncStep1
        const encoder = encoding.createEncoder();
        syncProtocol.writeSyncStep1(encoder, doc);
        const reply = encoding.toUint8Array(encoder);

        const frameEncoder = encoding.createEncoder();
        encoding.writeUint8(frameEncoder, MESSAGE_SYNC);
        encoding.writeVarUint8Array(frameEncoder, reply);
        ws.send(encoding.toUint8Array(frameEncoder));
      } else if (syncMessageType === 1 || syncMessageType === 2) {
        // SyncStep2 (1) or Update (2) from server - apply the update
        const update = decoding.readVarUint8Array(msgDecoder);
        if (update.length > 0) {
          Y.applyUpdate(doc, update, 'server');
        }

        if (!synced) {
          synced = true;
          syncResolveFn();
        }
      }
    }
  };

  ws.onclose = (event: CloseEvent) => {
    closeCode = event.code;
  };

  // Wait for initial sync to complete
  await Promise.race([
    syncPromise,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 10000))
  ]);

  // Set up update forwarding: when local doc changes, send to server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'server') return; // don't echo
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    const frameEncoder = encoding.createEncoder();
    encoding.writeUint8(frameEncoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(frameEncoder, encoding.toUint8Array(encoder));
    try {
      ws.send(encoding.toUint8Array(frameEncoder));
    } catch {
      // socket closed
    }
  });

  return {
    ws,
    doc,
    receivedMessages,
    get closeCode() { return closeCode; },
    waitForSync: async () => { /* already synced on creation */ },
    snapshot: () => doc,
    destroy: () => {
      try { ws.close(); } catch {}
    },
  };
}

/**
 * Sends raw bytes to a client's WebSocket (for malformed message tests).
 */
export function sendRaw(client: TestClient, data: Uint8Array | string): void {
  client.ws.send(data);
}

/**
 * Sends an awareness message through the proper framing.
 */
export function sendAwareness(client: TestClient, payload: Uint8Array): void {
  const frameEncoder = encoding.createEncoder();
  encoding.writeUint8(frameEncoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(frameEncoder, payload);
  client.ws.send(encoding.toUint8Array(frameEncoder));
}

/**
 * Waits for a specific condition on the client with a timeout.
 */
export function waitForCondition(
  fn: () => boolean,
  timeoutMs = 5000,
  description = 'condition'
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for: ${description}`));
      }
    }, 10);
  });
}
