import { request } from 'node:http';
import { expect, inject, test } from 'vitest';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { TestClient, waitFor } from './ws-client';

const port = inject('workerPort');

async function waitForFrameQuiescence(clients: TestClient[]): Promise<void> {
  const deadline = Date.now() + 15_000;
  let signature = '';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const current = clients.map((client) => client.log.syncKinds.length).join(',');
    if (current === signature && current !== '') return;
    signature = current;
  }
  throw new Error('sync frames did not quiesce');
}

function emptySnapshot(): string {
  const doc = new Y.Doc();
  return JSON.stringify(snapshot(doc));
}

// undici reserves the Upgrade header for fetch(), so the upgrade-attempted
// cases below use a raw request that workerd will still see.
function rawStatus(path: string, upgrade = true): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: upgrade ? { upgrade: 'websocket' } : {} }, (response) => {
      response.resume();
      resolve(response.statusCode ?? -1);
    });
    req.on('error', reject);
    req.end();
  });
}

test('TC-04 an invalid board id is 400 before the Durable Object is touched', async () => {
  for (const bad of ['bad!id', 'x'.repeat(30), 'short', 'a'.repeat(21)]) {
    const status = await rawStatus(`/api/rooms/${bad}`);
    expect(status, `id ${bad}`).toBe(400);
    expect(status).toBeLessThan(500);
  }
});

test('TC-05 a valid id without an Upgrade header is 426', async () => {
  expect(await rawStatus(`/api/rooms/${newBoardId()}`, false)).toBe(426);
});

test('TC-06 app routes fall back to the SPA index', async () => {
  for (const path of ['/', `/b/${newBoardId()}`, '/deep/client/route']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(response.status, path).toBe(200);
    expect(response.headers.get('content-type'), path).toContain('text/html');
    await response.body?.cancel();
  }
  // A valid id nobody has visited yet is addressed, not created.
  const client = await TestClient.connected(port, newBoardId());
  expect(client.provider.wsconnected).toBe(true);
  await client.close();
});

test('TC-13 a board accepts more than MAX_CONCURRENT_EDITORS sockets and syncs them all', async () => {
  const boardId = newBoardId();
  const clients: TestClient[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i += 1) {
    clients.push(await TestClient.connected(port, boardId));
  }
  expect(clients.every((client) => client.provider.wsconnected)).toBe(true);
  // Each client seeds the schema version on connect and the room relays that
  // write to every other socket. Wait for that relay traffic to go quiet
  // before taking the frame baseline, or a straggler relay is counted as a
  // duplicate below.
  await waitForFrameQuiescence(clients);
  const last = clients[clients.length - 1];
  const before = clients.map((client) => client.log.syncKinds.length);
  const noteId = createSticky(last.doc, { x: 10, y: 20 });
  if (typeof noteId !== 'string') throw new Error('note creation failed');
  await Promise.all(
    clients.slice(0, -1).map(async (client, index) => {
      await waitFor(
        () => (client.doc.getMap('objects').get(noteId) as unknown) !== undefined,
        `note on client ${String(index)}`,
        boardId
      );
      expect(client.framesSince(before[index])).toEqual([2]);
    })
  );
  const expected = last.boardSnapshot();
  for (const client of clients) expect(client.boardSnapshot()).toBe(expected);
  for (const client of clients) await client.close();
});

test('TC-17 clients on different boards never see each other', async () => {
  const idOne = newBoardId();
  const idTwo = newBoardId();
  const one = await TestClient.connected(port, idOne);
  const two = await TestClient.connected(port, idTwo);
  const twoBefore = two.log.syncKinds.length;
  const created = createSticky(one.doc, { x: 0, y: 0 });
  expect(typeof created).toBe('string');
  await waitFor(() => one.boardSnapshot() !== emptySnapshot(), 'creator sees own note', idOne);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(two.log.syncKinds.length).toBe(twoBefore);
  expect(two.boardSnapshot()).toBe(emptySnapshot());
  // A third client on board one sees board one only.
  const extra = await TestClient.connected(port, idOne);
  await waitFor(() => extra.boardSnapshot() === one.boardSnapshot(), 'third client catches up', idOne);
  expect(extra.boardSnapshot()).not.toBe(two.boardSnapshot());
  await one.close();
  await two.close();
  await extra.close();
});
