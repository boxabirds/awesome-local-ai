/**
 * Puts a board into a room the way a browser would: a Node WebSocket client that speaks the
 * y-websocket sync protocol, sends the whole document, and waits for the room's round trip
 * (the room handles one socket's frames in order, so the reply proves the board was applied
 * and stored). Plus the test-only storage hooks (server started with TEST_HOOKS=1).
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
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

/** Sends `doc`'s full state to board `boardId` and resolves once the room has stored it. */
export function seedBoard(baseURL: string, boardId: string, doc: Y.Doc): Promise<void> {
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

async function hook(baseURL: string, boardId: string, action: string): Promise<unknown> {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`test hook ${action} failed: ${res.status}`);
  const body = (await res.json()) as { result: unknown };
  return body.result;
}

export const compactBoard = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'compact');
export const corruptSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'corrupt-snapshot');
export const repairSnapshot = (baseURL: string, boardId: string) => hook(baseURL, boardId, 'repair');
