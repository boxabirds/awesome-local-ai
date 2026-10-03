/**
 * WebSocket client helper for integration tests.
 * 
 * IMPORTANT: The pattern that works in workerd is:
 * 1. SELF.fetch to get WebSocket
 * 2. ws.accept()
 * 3. Create Y.Doc
 * 4. initDoc(doc)
 * 5. Set ws.onmessage
 * 
 * The onmessage handler MUST be set up in the same scope as the test,
 * not in a separate function/class. This appears to be a workerd quirk.
 */
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { createDecoder, readUint8, readTailAsUint8Array } from 'lib0/decoding';
import { initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface WsClient {
  ws: WebSocket;
  doc: Y.Doc;
  flush: () => void;
  waitForSync: (timeoutMs?: number) => Promise<void>;
  getSnapshot: () => readonly StickySnapshot[];
  readonly messageCount: number;
  readonly closed: boolean;
  readonly closeCode: number | null;
  waitForClose: (timeoutMs?: number) => Promise<number | null>;
  sendRaw: (data: ArrayBuffer | string) => void;
  close: (code?: number) => void;
  sendAwareness: (payload: Uint8Array) => void;
}

/**
 * Create a WebSocket client for a board room.
 * The onmessage handler is set up by the caller via setupOnMessage.
 */
export async function connectToRoom(boardId: string): Promise<{
  ws: WebSocket;
  doc: Y.Doc;
  setup: (handler: (event: MessageEvent) => void) => void;
}> {
  const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade' },
  });
  if (response.status !== 101) {
    throw new Error(`Expected 101, got ${response.status}`);
  }
  const ws = (response as unknown as { webSocket: WebSocket }).webSocket;
  if (!ws) throw new Error('No WebSocket in response');
  if (typeof (ws as any).accept === 'function') {
    (ws as any).accept();
  }
  const doc = new Y.Doc();
  initDoc(doc);
  return {
    ws,
    doc,
    setup: (handler: (event: MessageEvent) => void) => {
      ws.onmessage = handler;
    },
  };
}

/**
 * Create a full WsClient with the proven working pattern.
 * This sets up the onmessage handler inline.
 */
export async function createClient(boardId: string): Promise<WsClient> {
  const { ws, doc } = await connectToRoom(boardId);
  
  let msgCount = 0;
  let closed = false;
  let closeCode: number | null = null;
  const closeResolvers: ((code: number | null) => void)[] = [];

  // This is the critical part - the handler is set up here,
  // in the same async context as the test.
  ws.onmessage = (event: MessageEvent) => {
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    if (bytes.length < 1) return;
    const d = createDecoder(bytes);
    const type = readUint8(d);
    const payload = readTailAsUint8Array(d);
    msgCount++;

    if (type === MESSAGE_SYNC) {
      const enc = createEncoder();
      try {
        syncProtocol.readSyncMessage(createDecoder(payload), enc, doc, 'remote');
        const resp = toUint8Array(enc);
        if (resp.length > 0) {
          const f = createEncoder();
          writeUint8(f, MESSAGE_SYNC);
          writeUint8Array(f, resp);
          ws.send(toUint8Array(f).slice().buffer as ArrayBuffer);
        }
      } catch {}
    }
  };

  ws.onclose = (event: CloseEvent) => {
    closed = true;
    closeCode = event.code;
    for (const r of closeResolvers) r(event.code);
    closeResolvers = [];
  };
  ws.onerror = () => {};

  return {
    ws,
    doc,
    flush: () => {
      if (closed) return;
      const update = Y.encodeStateAsUpdate(doc);
      if (update.length === 0) return;
      const enc = createEncoder();
      syncProtocol.writeUpdate(enc, update);
      const f = createEncoder();
      writeUint8(f, MESSAGE_SYNC);
      writeUint8Array(f, toUint8Array(enc));
      try { ws.send(toUint8Array(f).slice().buffer as ArrayBuffer); } catch {}
    },
    waitForSync: async (timeoutMs = 10000) => {
      const start = Date.now();
      while (msgCount === 0) {
        if (Date.now() - start > timeoutMs) throw new Error('waitForSync timeout');
        await new Promise(r => setTimeout(r, 10));
      }
      await new Promise(r => setTimeout(r, 200));
    },
    getSnapshot: () => snapshot(doc),
    get messageCount() { return msgCount; },
    get closed() { return closed; },
    get closeCode() { return closeCode; },
    waitForClose: (timeoutMs = 5000) => {
      if (closed) return Promise.resolve(closeCode);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitForClose timeout')), timeoutMs);
        closeResolvers.push((code) => { clearTimeout(timer); resolve(code); });
      });
    },
    sendRaw: (data: ArrayBuffer | string) => { ws.send(data); },
    close: (code = 1000) => { try { ws.close(code); } catch {} },
    sendAwareness: (payload: Uint8Array) => {
      if (closed) return;
      const f = createEncoder();
      writeUint8(f, MESSAGE_AWARENESS);
      writeUint8Array(f, payload);
      try { ws.send(toUint8Array(f).slice().buffer as ArrayBuffer); } catch {}
    },
  };
}

// Alias for backward compatibility
export { createClient as connectToRoomClient };
