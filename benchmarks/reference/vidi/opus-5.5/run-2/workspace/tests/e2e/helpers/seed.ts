/**
 * Seeds a board through the real room socket from Node (story 4 e2e): the fixture doc is
 * sent as one SyncStep2, exactly as a browser's y-websocket provider would, and the room's
 * reply to our SyncStep1 confirms it was applied (and therefore stored) before returning.
 * `compactBoard` / `corruptSnapshot` / `repairSnapshot` / `seedLegacyBoard` call the
 * TEST_HOOKS-only routes. Since story 5 a board must be created (`createBoard`) before its
 * room accepts sockets.
 */
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { snapshot } from '../../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

const SEED_TIMEOUT_MS = 30_000;
/** Header naming the simulated visitor for the creation rate limit (TEST_HOOKS runs only). */
export const TEST_VISITOR_HEADER = 'X-Test-Visitor';

/** A fresh visitor key, so helper-created boards never use up another test's creation limit. */
export function newVisitor(): string {
  return `e2e-${crypto.randomUUID()}`;
}

/** Creates a board through the real POST /api/boards and returns its id. */
export async function createBoard(baseURL: string, visitor = newVisitor()): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST', headers: { [TEST_VISITOR_HEADER]: visitor } });
  if (res.status !== 201) throw new Error(`creating a board failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

function frame(write: (e: encoding.Encoder) => void): Uint8Array<ArrayBuffer> {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  write(e);
  return new Uint8Array(encoding.toUint8Array(e));
}

export async function seedBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
  const expected = snapshot(doc).length;
  const ws = new WebSocket(`${baseURL.replace(/^http/, 'ws')}/api/rooms/${boardId}`);
  ws.binaryType = 'arraybuffer';
  const replica = new Y.Doc();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seeding timed out')), SEED_TIMEOUT_MS);
    ws.onerror = () => reject(new Error('seed socket error'));
    ws.onclose = (e) => reject(new Error(`seed socket closed ${e.code}`));
    ws.onopen = () => {
      ws.send(frame((e) => syncProtocol.writeSyncStep2(e, doc)));
      ws.send(frame((e) => syncProtocol.writeSyncStep1(e, replica)));
    };
    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const reply = encoding.createEncoder();
      const type = syncProtocol.readSyncMessage(decoder, reply, replica, 'seed');
      if (type === syncProtocol.messageYjsSyncStep2 && snapshot(replica).length >= expected) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  ws.onclose = null;
  ws.close(1000, 'seeded');
}

async function hook(baseURL: string, boardId: string, action: string, payload?: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, { method: 'POST', body: payload });
  const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
  if (!body.ok) throw new Error(`test hook ${action} failed: ${body.error}`);
  return body.result;
}

export const compactBoard = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'compact');
export const corruptSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'corrupt-snapshot');
export const repairSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'repair');
/** Stores `doc` as a board saved before story 5: content rows but no `created_at` (TC-31). */
export const seedLegacyBoard = (baseURL: string, boardId: string, doc: Y.Doc) =>
  hook(baseURL, boardId, 'seed-legacy', new Uint8Array(Y.encodeStateAsUpdate(doc)));
