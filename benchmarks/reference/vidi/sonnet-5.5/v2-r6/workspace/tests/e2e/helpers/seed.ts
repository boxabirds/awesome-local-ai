import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

function open(origin: string, boardId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace('http', 'ws')}/api/rooms/${boardId}`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('websocket error'));
  });
}

/** Opens the room as a client and returns a doc holding everything the server has. */
export async function readBoard(origin: string, boardId: string): Promise<Y.Doc> {
  const ws = await open(origin, boardId);
  const doc = new Y.Doc();
  const synced = new Promise<void>((resolve) => {
    ws.onmessage = (ev) => {
      const decoder = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      const kind = syncProtocol.readSyncMessage(decoder, reply, doc, 'remote');
      if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply));
      if (kind === syncProtocol.messageYjsSyncStep2) resolve();
    };
  });
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
  await synced;
  ws.close();
  return doc;
}

/** Sends every update to the room, then waits until the room reports holding `expectedNotes` notes. */
export async function seedBoard(origin: string, boardId: string, updates: Uint8Array[], expectedNotes: number): Promise<void> {
  const ws = await open(origin, boardId);
  for (const u of updates) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, u);
    ws.send(encoding.toUint8Array(enc));
  }
  const deadline = Date.now() + 60_000;
  for (;;) {
    const doc = await readBoard(origin, boardId);
    if (doc.getMap('objects').size >= expectedNotes) break;
    if (Date.now() > deadline) throw new Error('seeded board never fully arrived');
    await new Promise((r) => setTimeout(r, 200));
  }
  ws.close();
}
