// A Node-side board client (same framing as y-websocket) used to seed boards and
// read them back without a browser.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { snapshot } from '../../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { MESSAGE_SYNC, encodeSyncFrame } from '../../../src/shared/protocol';

const REMOTE = Symbol('remote');

export interface NodeBoardClient {
  doc: Y.Doc;
  close(): void;
}

/** Connects `doc` to the board's room and resolves after the initial sync. */
export function connectNode(baseURL: string, boardId: string, doc = new Y.Doc()): Promise<NodeBoardClient> {
  const url = `${baseURL.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => reject(new Error('sync timed out')), E2E_EVENTUAL_TIMEOUT_MS);
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeSyncFrame((e) => syncProtocol.writeUpdate(e, update)) as Uint8Array<ArrayBuffer>);
      }
    };
    doc.on('update', onUpdate);
    const client = {
      doc,
      close() {
        doc.off('update', onUpdate);
        ws.close();
      },
    };
    ws.addEventListener('open', () => ws.send(encodeSyncFrame((e) => syncProtocol.writeSyncStep1(e, doc)) as Uint8Array<ArrayBuffer>));
    ws.addEventListener('close', (e) => {
      clearTimeout(timer);
      reject(new Error(`closed ${e.code} before sync`));
    });
    ws.addEventListener('message', (e) => {
      const decoder = decoding.createDecoder(new Uint8Array(e.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const subtype = syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE);
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder) as Uint8Array<ArrayBuffer>);
      if (subtype === syncProtocol.messageYjsSyncStep2) {
        clearTimeout(timer);
        resolve(client);
      }
    });
  });
}

/**
 * Writes `doc` to the board and waits until a second, independent client reads
 * back the same notes (so the room has stored them).
 */
export async function seedBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
  const writer = await connectNode(baseURL, boardId, doc);
  const expected = JSON.stringify(snapshot(doc));
  const deadline = Date.now() + E2E_EVENTUAL_TIMEOUT_MS;
  try {
    for (;;) {
      const reader = await connectNode(baseURL, boardId);
      const same = JSON.stringify(snapshot(reader.doc)) === expected;
      reader.close();
      if (same) return;
      if (Date.now() > deadline) throw new Error('seeded board not read back');
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    writer.close();
  }
}

/** Calls a test-only room hook (TEST_HOOKS=1 servers only). */
export async function testHook(baseURL: string, boardId: string, action: 'compact' | 'corrupt-snapshot' | 'repair') {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`${action}: ${res.status} ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}
