import WebSocket from 'ws';
import * as Y from 'yjs';
import { createDecoder, readVarUint } from 'lib0/decoding';
import { createEncoder, toUint8Array, writeVarUint } from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { createSticky, initDoc } from '../../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';

// A reply encoder produced by syncProtocol.readSyncMessage holds the bare
// sync sub-message; on the wire it must be prefixed with the MESSAGE_SYNC
// frame byte (same framing as ws-client.ts).
function sendSyncReply(ws: WebSocket, encoder: ReturnType<typeof createEncoder>): void {
  const body = toUint8Array(encoder);
  if (body.length === 0) return;
  const out = new Uint8Array(body.length + 1);
  out[0] = MESSAGE_SYNC;
  out.set(body, 1);
  ws.send(out);
}

// Headless seeder: a real Y.Doc speaking the sync protocol over a plain
// WebSocket, used to plant large boards (PERSIST_TESTED_NOTES) far faster
// than the browser UI could. The room stores every update like any other
// client would.
export async function seedNotes(
  port: number,
  boardId: string,
  count: number
): Promise<void> {
  const doc = new Y.Doc();
  initDoc(doc);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${boardId}`);
  ws.binaryType = 'nodebuffer';
  ws.on('error', (error) => {
    throw error;
  });

  const sendSyncStep1 = (target: Y.Doc): void => {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, target);
    ws.send(toUint8Array(encoder));
  };

  // Apply every sync frame the room sends into both the seeding doc and the
  // supplied mirror, and reply correctly (MESSAGE_SYNC-prefixed) when asked.
  const pumpInto = (mirror: Y.Doc): void => {
    ws.on('message', (data: Buffer) => {
      const decoder = createDecoder(new Uint8Array(data));
      if (readVarUint(decoder) !== MESSAGE_SYNC) return;
      const encoder = createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, mirror, 'remote');
      sendSyncReply(ws, encoder);
    });
  };

  const synced = new Promise<void>((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error('seed sync handshake timed out')), 20_000);
    pumpInto(doc);
    ws.on('open', () => sendSyncStep1(doc));
    // The room answers our SyncStep1 with its stored state; once a round-trip
    // window passes the mirror mirrors the stored board and it is safe to write.
    ws.once('message', () => {
      clearTimeout(fail);
      setTimeout(resolve, 250);
    });
  });

  await synced;

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    ws.send(toUint8Array(encoder));
  });

  for (let i = 0; i < count; i += 1) {
    createSticky(doc, { x: (i % 50) * 220, y: Math.floor(i / 50) * 180 });
  }

  // Confirm the ROOM integrated every note (into a fresh mirror, not our own
  // doc) before disconnecting, so the room has stored them all.
  const mirror = new Y.Doc();
  initDoc(mirror);
  pumpInto(mirror);
  const roomHasAll = new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`room only reconstructed ${mirror.getMap('objects').size}/${count}`)),
      15_000
    );
    const poll = setInterval(() => {
      if (mirror.getMap('objects').size >= count) {
        clearTimeout(deadline);
        clearInterval(poll);
        resolve();
      }
    }, 150);
    sendSyncStep1(mirror);
  });

  await roomHasAll;
  await new Promise((resolve) => setTimeout(resolve, 400));
  ws.close();
  await new Promise<void>((resolve) => {
    const done = setTimeout(() => resolve(), 5000);
    ws.once('close', () => {
      clearTimeout(done);
      resolve();
    });
  });
}

// Story 5: create/ensure a board with a chosen id (server-side initialize
// RPC) so its /b/<id> link and room WebSocket are accepted. Requires test
// hooks on the wrangler instance.
export async function initBoard(port: number, boardId: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/__test/boards/${boardId}/initialize`,
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`initialize failed: ${response.status} ${await response.text()}`);
  }
}

// Story 5 (share.legacy_boards): write updates rows with no storage_meta
// created_at, so the board predates the create API yet must still open.
export async function seedLegacyBoard(port: number, boardId: string, updates: string[]): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/__test/boards/${boardId}/seed-legacy`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates })
    }
  );
  if (!response.ok) {
    throw new Error(`seed-legacy failed: ${response.status} ${await response.text()}`);
  }
}

export async function forceCompact(port: number, boardId: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/__test/boards/${boardId}/compact`,
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`compact failed: ${response.status} ${await response.text()}`);
  }
}

export async function corruptSnapshot(port: number, boardId: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/__test/boards/${boardId}/corrupt-snapshot`,
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`corrupt-snapshot failed: ${response.status} ${await response.text()}`);
  }
}

export async function repairSnapshot(port: number, boardId: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${port}/__test/boards/${boardId}/repair`,
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`repair failed: ${response.status} ${await response.text()}`);
  }
}

export async function readRowCount(port: number, boardId: string): Promise<{ updates: number; chunks: number }> {
  const response = await fetch(`http://127.0.0.1:${port}/__test/boards/${boardId}/rows`, {
    method: 'POST'
  });
  if (!response.ok) {
    throw new Error(`rows failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as { updates: number; chunks: number };
}

// Room-side readback: connect a fresh doc and report how many stickies the
// room reconstructs and broadcasts, isolating server state from the browser.
export async function readNoteCount(port: number, boardId: string): Promise<number> {
  const doc = new Y.Doc();
  initDoc(doc);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${boardId}`);
  ws.binaryType = 'nodebuffer';
  const done = new Promise<number>((resolve, reject) => {
    ws.once('error', reject);
    ws.on('open', () => {
      const encoder = createEncoder();
      writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(toUint8Array(encoder));
    });
    const start = Date.now();
    const timer = setInterval(() => {
      const count = doc.getMap('objects').size;
      if (count >= 1 && Date.now() - start > 600) {
        clearInterval(timer);
        ws.close();
        resolve(count);
      }
      if (Date.now() - start > 10_000) {
        clearInterval(timer);
        ws.close();
        resolve(count);
      }
    }, 150);
    ws.on('message', (data: Buffer) => {
      const decoder = createDecoder(new Uint8Array(data));
      if (readVarUint(decoder) !== MESSAGE_SYNC) return;
      const encoder = createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, doc, 'remote');
      sendSyncReply(ws, encoder);
    });
  });
  return done;
}
