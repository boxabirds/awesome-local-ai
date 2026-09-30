// Saves a board through the real room protocol from Node, and calls the
// test-only storage hooks (enabled by `--var TEST_HOOKS:1`).
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

function syncFrame(write: (e: encoding.Encoder) => void): Uint8Array<ArrayBuffer> {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder).slice();
}

/**
 * Sends `doc`'s full state to the board's room, then a SyncStep1. The room
 * answers the SyncStep1 only after it has applied and stored the state, so the
 * returned promise resolves once the board is saved.
 */
export async function seedBoard(baseURL: string, boardId: string, doc: Y.Doc, timeoutMs = 30_000): Promise<void> {
  const ws = new WebSocket(`${baseURL.replace(/^http/, 'ws')}/api/rooms/${boardId}`);
  ws.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('seed socket failed to open'));
  });
  const saved = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('seed not acknowledged')), timeoutMs);
    ws.onclose = (e) => reject(new Error(`seed socket closed ${e.code}`));
    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep2) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  ws.send(syncFrame((e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc))));
  ws.send(syncFrame((e) => syncProtocol.writeSyncStep1(e, new Y.Doc())));
  try {
    await saved;
  } finally {
    ws.onclose = null;
    ws.close();
  }
}

/** Creates a board through the real API (POST /api/boards, story 5). */
export async function createBoard(baseURL: string): Promise<string> {
  const response = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
  return ((await response.json()) as { id: string }).id;
}

/** Saves `doc` as a board from before story 5: an update row, but no `created_at` (test hook). */
export async function seedLegacyBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
  const response = await fetch(`${baseURL}/__test/boards/${boardId}/seed-legacy`, {
    method: 'POST',
    body: Y.encodeStateAsUpdate(doc).slice(),
  });
  const body = await response.text();
  if (!response.ok || !body.includes('"ok":true')) throw new Error(`seed-legacy failed: ${response.status} ${body}`);
}

export async function storageHook(
  baseURL: string,
  boardId: string,
  action: 'compact' | 'corrupt-snapshot' | 'repair',
): Promise<void> {
  const response = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, { method: 'POST' });
  const body = await response.text();
  if (!response.ok || !body.includes('"ok":true')) throw new Error(`hook ${action} failed: ${response.status} ${body}`);
}
