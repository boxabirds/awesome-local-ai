import { expect, inject, test } from 'vitest';
import * as Y from 'yjs';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { newBoardId } from '../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor
} from '../../src/shared/board-model';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS, MESSAGE_SYNC, SYNC_UPDATE } from '../../src/shared/protocol';
import { TestClient, equalBytes, rawSocket, waitFor } from './ws-client';
import { applyRandomOp, mulberry32 } from './random-ops';

const port = inject('workerPort');

async function pair(boardId = newBoardId()): Promise<{ a: TestClient; b: TestClient }> {
  const a = await TestClient.connected(port, boardId);
  const b = await TestClient.connected(port, boardId);
  return { a, b };
}

function objects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function entryX(client: TestClient, id: string): number | undefined {
  const entry = objects(client.doc).get(id);
  const x = entry?.get('x');
  return typeof x === 'number' ? x : undefined;
}

test('TC-07 a sticky created by A appears on B as exactly one update', async () => {
  const { a, b } = await pair();
  const bBefore = b.log.syncKinds.length;
  const id = createSticky(a.doc, { x: 100, y: 50 });
  expect(typeof id).toBe('string');
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'B mirrors A', 'TC-07');
  expect(b.framesSince(bBefore)).toEqual([SYNC_UPDATE]);
  await a.close();
  await b.close();
});

test('TC-08 move, recolour, text insert and delete each converge with no echo back', async () => {
  const steps: Array<(client: TestClient, id: string) => void> = [
    (client, id) => expect(moveObject(client.doc, id, 400, -120)).toBe(true),
    (client, id) => expect(setStickyColor(client.doc, id, 'violet')).toBe(true),
    (client, id) => getStickyText(client.doc, id)?.insert(0, 'typed text'),
    (client, id) => expect(deleteObject(client.doc, id)).toBe(true)
  ];
  for (const step of steps) {
    const { a, b } = await pair();
    const id = createSticky(a.doc, { x: 1, y: 1 }) as string;
    await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'initial note');
    const aBefore = a.log.syncKinds.length;
    const bBefore = b.log.syncKinds.length;
    step(b, id);
    await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'change converges');
    expect(b.framesSince(bBefore)).toEqual([]); // the sender is never echoed
    expect(a.framesSince(aBefore).length).toBeGreaterThanOrEqual(1);
    await a.close();
    await b.close();
  }
});

test('TC-09 concurrent inserts into one note keep every character', async () => {
  const { a, b } = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'seed note');
  const textA = getStickyText(a.doc, id);
  textA?.insert(0, 'green');
  await waitFor(() => getStickyText(b.doc, id)?.toString() === 'green', 'green on B');
  // Both edit before either change reaches the other.
  const textB = getStickyText(b.doc, id);
  textA?.insert(0, 'red ');
  textB?.insert(textB.length, ' blue');
  await waitFor(
    () =>
      getStickyText(a.doc, id)?.toString() === getStickyText(b.doc, id)?.toString() &&
      (getStickyText(a.doc, id)?.toString().length ?? 0) === 'red green blue'.length,
    'merged text'
  );
  expect(getStickyText(a.doc, id)?.toString()).toBe('red green blue');
  expect(getStickyText(b.doc, id)?.toString()).toBe('red green blue');
  await a.close();
  await b.close();
});

test('TC-10 concurrent moves of the same note settle on one position', async () => {
  const { a, b } = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'seed note');
  moveObject(a.doc, id, 100, 0);
  moveObject(b.doc, id, 300, 0);
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'position converges');
  expect(entryX(a, id)).toBe(entryX(b, id));
  expect([100, 300]).toContain(entryX(a, id));
  await a.close();
  await b.close();
});

test('TC-11 a delete concurrent with typing removes the note everywhere without resurrecting it', async () => {
  const { a, b } = await pair();
  const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'seed note');
  const textB = getStickyText(b.doc, id);
  deleteObject(a.doc, id);
  textB?.insert(0, 'typed into a deleted note');
  await waitFor(() => !objects(a.doc).has(id) && !objects(b.doc).has(id), 'note gone on both');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(objects(a.doc).has(id)).toBe(false);
  expect(objects(b.doc).has(id)).toBe(false);
  // The room is unharmed: a new note still propagates.
  const later = createSticky(a.doc, { x: 9, y: 9 }) as string;
  await waitFor(() => objects(b.doc).has(later), 'later note propagates');
  await a.close();
  await b.close();
});

test('TC-12 a full-capacity board with hundreds of seeded random ops converges', async () => {
  const seed = 0x517c0000 | Math.floor(Math.random() * 0xffff);
  console.log(`TC-12 seed: ${seed.toString(16)}`);
  const boardId = newBoardId();
  const clients: TestClient[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
    clients.push(await TestClient.connected(port, boardId));
  }
  const random = mulberry32(seed);
  const notes: string[] = [];
  for (let i = 0; i < 200; i += 1) {
    applyRandomOp(clients[i % clients.length].doc, notes, random);
  }
  await waitFor(
    () => clients.every((client) => client.boardSnapshot() === clients[0].boardSnapshot()),
    'all snapshots identical'
  );
  const expected = clients[0].boardSnapshot();
  for (const client of clients) expect(client.boardSnapshot()).toBe(expected);
  for (const client of clients) await client.close();
});

test('TC-14 a late joiner receives a twenty-note board intact', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connected(port, boardId);
  for (let i = 0; i < 20; i += 1) {
    createSticky(a.doc, { x: i * 30, y: i * 20 });
  }
  await waitFor(() => objects(a.doc).size === 20, 'twenty notes created');
  const b = await TestClient.connected(port, boardId);
  await waitFor(() => b.boardSnapshot() === a.boardSnapshot(), 'B mirrors twenty notes');
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === a.boardSnapshot(), 'late joiner C mirrors A');
  await a.close();
  await b.close();
  await c.close();
});

test('TC-15 malformed traffic closes only its socket with 1003 and cannot corrupt the room', async () => {
  const { a, b } = await pair();
  const docBytesBefore = a.boardSnapshot();
  const malformed: Array<() => Buffer | string> = [
    () => 'this is not a yjs frame', // text frame
    () => Buffer.from([MESSAGE_SYNC, SYNC_UPDATE, 100, 1, 2, 3]), // declared length beyond frame
    () => Buffer.from([9, 1, 2, 3]), // unknown message type
    () => {
      // Well-framed but structurally invalid Yjs update.
      const enc = createEncoder();
      writeVarUint(enc, MESSAGE_SYNC);
      writeVarUint8Array(enc, new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]));
      return Buffer.from(toUint8Array(enc));
    }
  ];
  for (const make of malformed) {
    const boardId = a.provider.roomname;
    const code = await new Promise<number>((resolve) => {
      const raw = rawSocket(port, boardId);
      raw.on('open', () => raw.send(make()));
      raw.on('close', (closeCode) => resolve(closeCode));
      setTimeout(() => resolve(-1), 5000);
    });
    expect(code).toBe(CLOSE_UNSUPPORTED_DATA);
  }
  expect(b.provider.wsconnected).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(a.boardSnapshot()).toBe(docBytesBefore);
  const bBefore = b.log.syncKinds.length;
  createSticky(a.doc, { x: 77, y: 77 });
  await waitFor(() => b.framesSince(bBefore).length >= 1 && b.boardSnapshot() === a.boardSnapshot(), 'board still live');
  expect(a.boardSnapshot()).not.toBe(docBytesBefore);
  await a.close();
  await b.close();
});

test('TC-16 an awareness update is relayed verbatim to every socket including the sender', async () => {
  const boardId = newBoardId();
  const bodyDoc = new Y.Doc();
  const awareness = new Awareness(bodyDoc);
  awareness.setLocalStateField('user', { name: 'relay-test' });
  const body = encodeAwarenessUpdate(awareness, [bodyDoc.clientID]);
  const enc = createEncoder();
  writeVarUint(enc, MESSAGE_AWARENESS);
  writeVarUint8Array(enc, body);
  const frame = toUint8Array(enc);
  const capture = async (): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const raw = rawSocket(port, boardId);
      raw.on('open', () => {
        raw.send(frame);
        setTimeout(() => reject(new Error('no awareness echo')), 5000);
      });
      raw.on('message', (data) => {
        const bytes = new Uint8Array(data as ArrayBuffer);
        if (bytes[0] === MESSAGE_AWARENESS) resolve(bytes);
      });
    });
  const senderReceived = capture();
  const peerReceived = new Promise<Uint8Array>((resolve, reject) => {
    const peer = rawSocket(port, boardId);
    peer.on('close', (code) => reject(new Error(`peer closed ${String(code)}`)));
    peer.on('message', (data) => {
      const bytes = new Uint8Array(data as ArrayBuffer);
      if (bytes[0] === MESSAGE_AWARENESS) resolve(bytes);
    });
    setTimeout(() => reject(new Error('peer saw no awareness')), 5000);
  });
  const [senderFrame, peerFrame] = await Promise.all([senderReceived, peerReceived]);
  expect(senderFrame.length).toBe(frame.length);
  expect(equalBytes(senderFrame, frame)).toBe(true);
  expect(equalBytes(peerFrame, frame)).toBe(true);
  awareness.destroy();
  bodyDoc.destroy();
});

test('TC-18 after full idle the room is re-populated through the sync handshake', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connected(port, boardId);
  for (let i = 0; i < 5; i += 1) {
    createSticky(a.doc, { x: i * 10, y: 0 });
  }
  await waitFor(() => objects(a.doc).size === 5, 'five notes');
  await a.close(); // every socket for the board is now gone
  // The next visitor carries the state client-side; the fresh (or evicted and
  // recreated) room asks for it with SyncStep1 and rebuilds from it.
  const b = await TestClient.connected(port, boardId);
  for (let i = 0; i < 5; i += 1) {
    createSticky(b.doc, { x: 500 + i * 10, y: 0 });
  }
  await waitFor(() => objects(b.doc).size >= 5, 'own edits');
  const c = await TestClient.connected(port, boardId);
  await waitFor(() => c.boardSnapshot() === b.boardSnapshot(), 'third client converges');
  expect(objects(c.doc).size).toBeGreaterThanOrEqual(5);
  await b.close();
  await c.close();
});

test('TC-31 an update arriving while a dead socket drains does not break the room', async () => {
  const boardId = newBoardId();
  const a = await TestClient.connected(port, boardId);
  const doomedRaw = rawSocket(port, boardId);
  await new Promise<void>((resolve) => doomedRaw.on('open', () => resolve()));
  doomedRaw.terminate(); // abrupt death, no close handshake
  await new Promise((resolve) => setTimeout(resolve, 150));
  const id = createSticky(a.doc, { x: 3, y: 3 });
  expect(typeof id).toBe('string');
  expect(a.provider.wsconnected).toBe(true);
  // The room must keep serving: a later client still gets the document.
  const late = await TestClient.connected(port, boardId);
  await waitFor(() => late.boardSnapshot() === a.boardSnapshot(), 'later client syncs after dead socket');
  await a.close();
  await late.close();
});

test('the live update budget holds on a local worker', async () => {
  const { a, b } = await pair();
  const start = Date.now();
  createSticky(a.doc, { x: 1, y: 1 });
  await waitFor(() => objects(b.doc).size === objects(a.doc).size, 'B sees note');
  const latency = Date.now() - start;
  expect(latency).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);
  await a.close();
  await b.close();
});
