// Writes a board straight into a running service over the room's WebSocket protocol (Node),
// the same way a browser's first sync would, and waits until the room has stored it.
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { decodeMessage, encodeSyncStep1, encodeUpdate } from '../../../src/shared/protocol';

function isSyncStep2(data: ArrayBuffer): boolean {
  const msg = decodeMessage(new Uint8Array(data));
  if (msg.kind !== 'sync') return false;
  return decoding.readVarUint(decoding.createDecoder(msg.payload)) === syncProtocol.messageYjsSyncStep2;
}

/** Sends every update to board `boardId` at `baseURL`, then waits for the room to answer. */
export async function seedBoard(baseURL: string, boardId: string, updates: Uint8Array[]) {
  const url = `${baseURL.replace(/^http/, 'ws').replace('//localhost:', '//127.0.0.1:')}/api/rooms/${boardId}`;
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
  });
  const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
  // The room handles one socket's messages in order: once it answers this SyncStep1, every
  // update before it has been applied and stored.
  const answered = new Promise<void>((resolve) => {
    ws.onmessage = (e) => {
      if (isSyncStep2(e.data as ArrayBuffer)) resolve();
    };
  });
  const send = (frame: Uint8Array) => ws.send(frame as Uint8Array<ArrayBuffer>);
  for (const u of updates) send(encodeUpdate(u));
  send(encodeSyncStep1(new Y.Doc()));
  const outcome = await Promise.race([answered.then(() => null), closed]);
  ws.close();
  if (outcome !== null) throw new Error(`room closed the seeding socket with ${outcome}`);
}
