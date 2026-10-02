/**
 * Integration test helper: opens a WebSocket to a running wrangler dev server,
 * wraps a real Y.Doc speaking y-protocols.
 */
import * as Y from 'yjs';
import {
  writeSyncStep1,
  writeUpdate,
  readSyncMessage,
} from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  decodeMessage,
  encodeSyncMessage,
} from '../../src/shared/protocol';

export interface WsClient {
  doc: Y.Doc;
  ws: WebSocket;
  received: ArrayBuffer[];
  /** Close code observed when the socket closes (null until then). */
  closeCode: number | null;
  /** Resolves with the close code when the socket closes. */
  closed: Promise<number>;
  /** Wait until no new messages for 100ms. */
  waitForQuiet(timeoutMs?: number): Promise<void>;
  /** Send raw bytes on the WebSocket. */
  sendRaw(data: ArrayBuffer | string): void;
  /** Wait for at least N more messages. */
  waitForMessages(n: number, timeoutMs?: number): Promise<ArrayBuffer[]>;
  close(): void;
}

/**
 * Create a WebSocket client connected to the BoardRoom for the given boardId.
 * `wsBase` is like "ws://localhost:8799/api/rooms"
 */
export async function createWsClient(
  wsBase: string,
  boardId: string,
): Promise<WsClient> {
  const doc = new Y.Doc();

  const url = `${wsBase}/${boardId}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const received: ArrayBuffer[] = [];
  let messageResolvers: Array<(data: ArrayBuffer) => void> = [];
  let closeCode: number | null = null;
  let resolveClosed: ((code: number) => void) | null = null;
  const closed = new Promise<number>((r) => {
    resolveClosed = r;
  });

  // When the local doc changes, send the update to the server
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'server') return;
    if (ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    writeUpdate(enc, update);
    const syncPayload = encoding.toUint8Array(enc);
    const frame = encodeSyncMessage(syncPayload);
    ws.send(frame);
  });

  // Wait for connection open
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`WebSocket connection failed to ${url}`)));
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
  });

  ws.addEventListener('message', (event) => {
    const data = event.data instanceof ArrayBuffer ? event.data : (event.data as ArrayBuffer);
    received.push(data);

    // Process sync messages automatically
    const decoded = decodeMessage(data);
    if (decoded.kind === 'sync') {
      handleSyncMessage(decoded.payload);
    }

    // Resolve message waiters
    while (messageResolvers.length > 0) {
      const resolve = messageResolvers.shift()!;
      resolve(data);
    }
  });

  ws.addEventListener('close', (ev) => {
    closeCode = (ev as CloseEvent).code;
    if (resolveClosed) resolveClosed(closeCode);
    for (const r of messageResolvers) r(new ArrayBuffer(0));
  });

  function handleSyncMessage(payload: Uint8Array) {
    try {
      const decoder = decoding.createDecoder(payload);
      const enc = encoding.createEncoder();
      readSyncMessage(decoder, enc, doc, 'server');
      const reply = encoding.toUint8Array(enc);
      if (reply.byteLength > 0) {
        const frame = encodeSyncMessage(reply);
        ws.send(frame);
      }
    } catch {
      // Ignore errors
    }
  }

  // Wait for the server's SyncStep1 (first message), then send our SyncStep1
  await new Promise<void>((resolve) => {
    if (received.length > 0) {
      resolve();
      return;
    }
    messageResolvers.push(() => resolve());
    setTimeout(() => resolve(), 3000);
  });

  // Send our SyncStep1
  const enc = encoding.createEncoder();
  writeSyncStep1(enc, doc);
  ws.send(encodeSyncMessage(encoding.toUint8Array(enc)));

  // Brief wait for initial sync exchange to complete
  await new Promise<void>((resolve) => {
    let lastCount = received.length;
    let quietMs = 0;
    const interval = setInterval(() => {
      if (received.length === lastCount) {
        quietMs += 50;
        if (quietMs >= 100) {
          clearInterval(interval);
          resolve();
        }
      } else {
        quietMs = 0;
        lastCount = received.length;
      }
    }, 50);
    // Force resolve after 2s
    setTimeout(() => { clearInterval(interval); resolve(); }, 2000);
  });

  return {
    doc,
    ws,
    received,
    get closeCode() {
      return closeCode;
    },
    closed,

    waitForQuiet(timeoutMs = 5000): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitForQuiet timeout')), timeoutMs);
        let lastCount = received.length;
        let quietMs = 0;
        const interval = setInterval(() => {
          if (received.length === lastCount && received.length > 0) {
            quietMs += 50;
            if (quietMs >= 100) {
              clearInterval(interval);
              clearTimeout(timer);
              resolve();
            }
          } else {
            quietMs = 0;
            lastCount = received.length;
          }
        }, 50);
      });
    },

    sendRaw(data: ArrayBuffer | string) {
      ws.send(data);
    },

    waitForMessages(n: number, timeoutMs = 5000): Promise<ArrayBuffer[]> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitForMessages timeout')), timeoutMs);
        const results: ArrayBuffer[] = [];
        const collect = (data: ArrayBuffer) => {
          results.push(data);
          if (results.length >= n) {
            clearTimeout(timer);
            resolve(results);
          } else {
            messageResolvers.push(collect);
          }
        };
        messageResolvers.push(collect);
      });
    },

    close() {
      ws.close();
    },
  };
}
