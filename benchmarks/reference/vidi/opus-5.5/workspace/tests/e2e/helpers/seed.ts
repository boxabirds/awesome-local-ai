/**
 * Puts a board into a room the way a browser would: a Node WebSocket client that speaks the
 * y-websocket sync protocol, sends the whole document, and waits for the room's round trip
 * (the room handles one socket's frames in order, so the reply proves the board was applied
 * and stored). Plus the test-only storage hooks (server started with TEST_HOOKS=1).
 *
 * Story 5: boards exist only once created. Tests that do not exercise creation itself create
 * boards through the TEST_HOOKS-only `initialize` route, which bypasses the per-visitor
 * creation limit (every test shares 127.0.0.1).
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { newBoardId } from '../../../src/shared/board-id';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

const SEED_TIMEOUT_MS = 60_000;

function syncFrame(write: (e: encoding.Encoder) => void): ArrayBuffer {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_SYNC);
  write(e);
  return encoding.toUint8Array(e).slice().buffer as ArrayBuffer;
}

function wsUrl(baseURL: string, boardId: string): string {
  return `${baseURL.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
}

/** Sends `doc`'s full state to board `boardId` (created first if needed) once the room has stored it. */
export async function seedBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
  await initializeBoard(baseURL, boardId);
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl(baseURL, boardId));
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('seeding timed out'));
    }, SEED_TIMEOUT_MS);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('seeding socket failed'));
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      reject(new Error(`room closed the seeding socket: ${e.code}`));
    };
    ws.onopen = () => {
      ws.send(syncFrame((e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc))));
      // Round trip: our state vector; the SyncStep2 reply arrives after the update was handled.
      ws.send(syncFrame((e) => syncProtocol.writeSyncStep1(e, doc)));
    };
    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      if (decoding.readVarUint(decoder) !== syncProtocol.messageYjsSyncStep2) return;
      clearTimeout(timer);
      ws.onclose = null;
      ws.close();
      resolve();
    };
  });
}

/**
 * `wrangler dev`'s proxy does not retry a POST whose pooled connection to the local runtime went
 * stale while idle; it answers 500 "Network connection lost" without the Worker ever seeing the
 * request. Idempotent hooks are retried in that case (dev tooling only, not app behaviour).
 */
const IDEMPOTENT_ACTIONS = new Set(['initialize']);
const STALE_CONNECTION = 'Network connection lost';
const HOOK_ATTEMPTS = 3;

async function hook(baseURL: string, boardId: string, action: string, payload?: Uint8Array): Promise<unknown> {
  const attempts = IDEMPOTENT_ACTIONS.has(action) ? HOOK_ATTEMPTS : 1;
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, {
      method: 'POST',
      body: payload === undefined ? undefined : (payload.slice().buffer as ArrayBuffer),
    });
    if (res.ok) {
      const body = (await res.json()) as { result: unknown };
      return body.result;
    }
    const text = await res.text();
    if (attempt < attempts && text.includes(STALE_CONNECTION)) continue;
    throw new Error(`test hook ${action} failed: ${res.status} ${text.slice(0, 500)}`);
  }
}

export const compactBoard = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'compact');
export const corruptSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'corrupt-snapshot');
export const repairSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'repair');

/** Creates the board at `boardId` unless it exists ('created' | 'exists'). */
export const initializeBoard = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'initialize');

/** A new, empty board (created without the rate limit); returns its id. */
export async function createTestBoard(baseURL: string): Promise<string> {
  const boardId = newBoardId();
  if ((await initializeBoard(baseURL, boardId)) !== 'created') throw new Error('board id collision');
  return boardId;
}

/** Stores `doc` as a board saved before story 5: log rows and no created_at. */
export async function seedLegacyBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
  if ((await hook(baseURL, boardId, 'seed-legacy', Y.encodeStateAsUpdate(doc))) !== true) {
    throw new Error('legacy board was not seeded');
  }
}
