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

/** Node cannot reach `localhost` when wrangler listens on 127.0.0.1 only. */
const ipv4 = (baseURL: string) => baseURL.replace('//localhost:', '//127.0.0.1:');

/** Creates a board through the real API (POST /api/boards), as New board does; returns its id. */
export async function createBoardViaApi(baseURL: string): Promise<string> {
  const res = await fetch(`${ipv4(baseURL)}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`POST /api/boards answered ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}

/**
 * Stores `update` as a board saved before boards were created explicitly (update rows, no
 * created_at) through the TEST_HOOKS-only route.
 */
export async function seedLegacyBoard(baseURL: string, boardId: string, update: Uint8Array) {
  const res = await fetch(`${ipv4(baseURL)}/__test/boards/${boardId}/seed-legacy`, {
    method: 'POST',
    body: update as Uint8Array<ArrayBuffer>,
  });
  if (res.status !== 200) throw new Error(`seed-legacy answered ${res.status}: ${await res.text()}`);
}

/** Sends every update to board `boardId` at `baseURL`, then waits for the room to answer. */
export async function seedBoard(baseURL: string, boardId: string, updates: Uint8Array[]) {
  const url = `${ipv4(baseURL).replace(/^http/, 'ws')}/api/rooms/${boardId}`;
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
