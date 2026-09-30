import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import WebSocket from 'ws';
import { MESSAGE_SYNC, MESSAGE_AWARENESS } from '../../src/shared/protocol';

export interface TestClient {
  ws: WebSocket;
  doc: Y.Doc;
  stats: { sent: number; recvAll: number; sendFail: number };
  receivedMessages: Uint8Array[];
  closeCode: number | null;
  waitForSync: () => Promise<void>;
  snapshot: () => Y.Doc;
  destroy: () => void;
}

/** Builds a [MESSAGE_SYNC varuint][raw payload] frame (no length prefix). */
function frameSyncRaw(payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  const header = encoding.toUint8Array(enc);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/**
 * Creates a test WebSocket client that speaks the y-websocket protocol
 * framing: [message_type: varuint][payload] where the sync payload is raw
 * (NOT length-prefixed) and the awareness payload is a varuint8array.
 *
 * Uses the `ws` package rather than the Node built-in WebSocket: the
 * built-in (undici) client drops inbound frames under burst load, which
 * made convergence tests flaky (see story 4 notes).
 */
export async function createTestClient(url: string, boardId: string, existingDoc?: Y.Doc): Promise<TestClient> {
  // `existingDoc` lets a reconnecting client keep the doc it already holds
  // (story 4 TC-14: a client re-sends its unsaved change after a storage failure).
  const doc = existingDoc ?? new Y.Doc();
  const wsUrl = url.replace('http', 'ws') + `/api/rooms/${boardId}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  const receivedMessages: Uint8Array[] = [];
  let closeCode: number | null = null;
  const stats = { sent: 0, recvAll: 0, sendFail: 0 };

  // Attach listeners BEFORE awaiting open: the server sends SyncStep1 as
  // soon as the upgrade completes, and a message arriving in the gap
  // between 'open' and listener registration would be silently dropped
  // (breaking the handshake → sync timeout).
  let synced = false;
  let syncResolveFn: () => void = () => {};
  let syncRejectFn: (e: Error) => void = () => {};
  const syncPromise = new Promise<void>((resolve, reject) => { syncResolveFn = resolve; syncRejectFn = reject; });

  const onMessage = (data: ArrayBuffer | Buffer) => {
    stats.recvAll++;
    const bytes = new Uint8Array(data as ArrayBuffer);
    receivedMessages.push(bytes.slice());
    if (bytes.length < 1) return;
    // Outer type is a small varuint (0/1/3 → single byte in this protocol).
    const type = bytes[0];

    if (type === MESSAGE_SYNC) {
      // The sync payload is the remainder of the frame (starts with the
      // y-protocols sync message type).
      const payload = bytes.subarray(1);
      const msgDecoder = decoding.createDecoder(payload);
      const syncMessageType = decoding.readVarUint(msgDecoder);

      if (syncMessageType === 0) {
        // SyncStep1 from server: reply with a SyncStep2 computed against the
        // server's state vector — this sends everything the server is missing
        // (e.g. local-only changes after a reconnection).
        const serverSV = decoding.readVarUint8Array(msgDecoder);
        const encoder = encoding.createEncoder();
        syncProtocol.writeSyncStep2(encoder, doc, serverSV);
        ws.send(frameSyncRaw(encoding.toUint8Array(encoder)));
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
    } else if (type === MESSAGE_AWARENESS) {
      // Awareness frames are not needed by the test client.
    }
  };

  ws.on('message', onMessage);

  ws.on('close', (code: number) => {
    closeCode = code;
    // Fail fast if the room closed us before sync completed (e.g. 4500 while
    // the room is reloading) instead of waiting out the sync timeout.
    if (!synced) {
      syncRejectFn(new Error(`socket closed ${code} before sync`));
    }
  });

  // Wait for open, then initiate the sync by sending our SyncStep1 (the
  // server answers with a SyncStep2 containing everything we are missing).
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      const encoder = encoding.createEncoder();
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(frameSyncRaw(encoding.toUint8Array(encoder)));
      resolve();
    });
    ws.on('error', (e: Error) => reject(new Error(`WebSocket error connecting to ${wsUrl}: ${e.message}`)));
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
  });

  // Wait for initial sync to complete
  try {
    await Promise.race([
      syncPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 10000))
    ]);
  } catch (e) {
    try { ws.close(); } catch { /* already closed */ }
    throw e;
  }

  // Guarantee the server has all local data: our SyncStep2 (which carries
  // local-only changes) is only sent in reply to the server's SyncStep1, and
  // that frame is not sent when the room is mid-reload. A full-state update
  // is an idempotent CRDT merge — a no-op when the server already has it.
  {
    const full = Y.encodeStateAsUpdate(doc);
    if (full.length > 0) {
      const enc = encoding.createEncoder();
      syncProtocol.writeUpdate(enc, full);
      try {
        ws.send(frameSyncRaw(encoding.toUint8Array(enc)));
      } catch {
        // socket closed
      }
    }
  }

  // Set up update forwarding: when local doc changes, send to server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'server') return; // don't echo
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);
    try {
      ws.send(frameSyncRaw(encoding.toUint8Array(encoder)));
      stats.sent++;
    } catch {
      stats.sendFail++;
      // socket closed
    }
  });

  return {
    ws,
    doc,
    receivedMessages,
    stats,
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
  encoding.writeVarUint(frameEncoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(frameEncoder, payload);
  client.ws.send(encoding.toUint8Array(frameEncoder));
}

/**
 * Opens a raw WebSocket (no y-protocols handshake). Used for tests where
 * the room closes the socket before sync (e.g. load-failed → 4500).
 * Resolves with the close code (or null if the socket closed before open).
 */
export function connectRaw(url: string, boardId: string, timeoutMs = 10000): Promise<{ code: number; reason: string }> {
  const wsUrl = url.replace('http', 'ws') + `/api/rooms/${boardId}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  let resender: ReturnType<typeof setInterval> | null = null;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (resender) clearInterval(resender);
      ws.close();
      reject(new Error(`connectRaw timeout for ${boardId}`));
    }, timeoutMs);
    // Send an initial SyncStep1 like real clients do on connect: this is what
    // triggers the room's 4500 close when the room is not ready (a close
    // initiated from the server's fetch context is not delivered by the
    // runtime until the client speaks). Frames sent immediately after the
    // upgrade can be dropped by the runtime, so resend every 300ms until the
    // close arrives (a real client keeps its provider alive and retries).
    ws.on('open', () => {
      const doc = new Y.Doc();
      const enc = encoding.createEncoder();
      syncProtocol.writeSyncStep1(enc, doc);
      const frame = frameSyncRaw(encoding.toUint8Array(enc));
      const send = () => {
        try {
          if (ws.readyState === 1) ws.send(frame);
        } catch {
          // socket already closing
        }
      };
      setTimeout(send, 50);
      resender = setInterval(send, 300);
    });
    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(timer);
      if (resender) clearInterval(resender);
      resolve({ code, reason: reason.toString() });
    });
    ws.on('error', () => {
      // close follows; nothing to do here
    });
  });
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
