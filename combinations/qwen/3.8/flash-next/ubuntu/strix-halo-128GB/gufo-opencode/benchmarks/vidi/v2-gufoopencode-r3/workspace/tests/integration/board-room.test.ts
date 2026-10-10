/// <reference types="@cloudflare/vitest-pool-workers" />
import { SELF } from 'cloudflare:test';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array
} from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  moveObject,
  snapshot,
  type StickySnapshot
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC
} from '../../src/shared/protocol';
import { mulberry32, runRandomOps } from './random-ops';
import { RoomClient, connectBoard, waitFor } from './ws-client';

const fetcher = SELF.fetch.bind(SELF);
const newId = () => crypto.randomUUID().slice(0, 8) + '-' + Date.now();

function sortById(notes: readonly StickySnapshot[]): StickySnapshot[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function settle(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('BoardRoom sync relay (TC-07, TC-08)', () => {
  it('TC-07 relays an edit as exactly one sync update frame', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    const frameIndex = b.frames.length;
    createSticky(a.doc, { x: 50, y: 60 });
    await waitFor(() => b.snapshot().length === 1);
    await settle();

    const received = b.newFramesSince(frameIndex);
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe(MESSAGE_SYNC);
    expect(b.snapshot()).toEqual(a.snapshot());

    a.closeNow();
    b.closeNow();
  });

  it('TC-08 does not echo a client own updates back to it', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    const frameIndex = a.frames.length;
    createSticky(a.doc, { x: 1, y: 2 });
    await waitFor(() => b.snapshot().length === 1);
    await settle();

    expect(a.newFramesSince(frameIndex)).toHaveLength(0);

    a.closeNow();
    b.closeNow();
  });
});

describe('BoardRoom CRDT convergence (TC-09, TC-10, TC-11)', () => {
  it('TC-09 converges concurrent text inserts to identical text', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    const textA = getStickyText(a.doc, id);
    expect(textA).toBeDefined();
    a.doc.transact(() => textA?.insert(0, 'green'), LOCAL_ORIGIN);
    await a.waitForSync();
    await b.waitForSync();
    expect(getStickyText(b.doc, id)?.toString()).toBe('green');

    a.pauseSync();
    b.pauseSync();
    a.doc.transact(() => textA?.insert(0, 'red '), LOCAL_ORIGIN);
    const textB = getStickyText(b.doc, id);
    expect(textB).toBeDefined();
    if (textB === undefined) return;
    b.doc.transact(() => textB.insert(textB.length, ' blue'), LOCAL_ORIGIN);
    a.resumeSync();
    b.resumeSync();

    await waitFor(() => getStickyText(a.doc, id)?.toString() === getStickyText(b.doc, id)?.toString());
    expect(getStickyText(a.doc, id)?.toString()).toBe('red green blue');
    expect(getStickyText(b.doc, id)?.toString()).toBe('red green blue');

    a.closeNow();
    b.closeNow();
  });

  it('TC-10 converges concurrent moves to one agreed position', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await a.waitForSync();
    await b.waitForSync();

    a.pauseSync();
    b.pauseSync();
    moveObject(a.doc, id, 100, 20);
    moveObject(b.doc, id, 300, 20);
    a.resumeSync();
    b.resumeSync();

    await waitFor(() => {
      const noteA = a.snapshot().find((n) => n.id === id);
      const noteB = b.snapshot().find((n) => n.id === id);
      return noteA !== undefined && noteB !== undefined && noteA.x === noteB.x;
    });
    const finalX = a.snapshot().find((n) => n.id === id)?.x;
    expect(finalX === 100 || finalX === 300).toBe(true);

    a.closeNow();
    b.closeNow();
  });

  it('TC-11 keeps concurrent creates distinct and visible to everyone', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    a.pauseSync();
    b.pauseSync();
    const idA = createSticky(a.doc, { x: 10, y: 10 });
    const idB = createSticky(b.doc, { x: 20, y: 20 });
    expect(idA).not.toBe(idB);
    a.resumeSync();
    b.resumeSync();

    await waitFor(() => a.snapshot().length === 2 && b.snapshot().length === 2);
    const ids = a.snapshot().map((n) => n.id).sort();
    expect(ids).toEqual([idA, idB].sort());

    a.closeNow();
    b.closeNow();
  });
});

describe('BoardRoom randomized convergence (TC-12)', () => {
  it('TC-12 five clients converge after interleaved random ops', async () => {
    const boardId = newId();
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    console.log(`TC-12 seed: ${seed} (reproducible with this seed)`);

    const clients: RoomClient[] = [];
    for (let i = 0; i < 5; i += 1) {
      clients.push(await connectBoard(fetcher, boardId));
    }

    const created = new Set<string>();
    const deleted = new Set<string>();
    const opsPerClient = 150;
    const chunk = 10;
    await Promise.all(
      clients.map(async (client, i) => {
        const rand = mulberry32((seed + i * 7919) >>> 0);
        for (let done = 0; done < opsPerClient; done += chunk) {
          const log = runRandomOps(client.doc, rand, chunk);
          for (const id of log.created) created.add(id);
          for (const id of log.deleted) deleted.add(id);
          await settle(0);
        }
      })
    );

    for (const client of clients) await client.waitForSync(150);
    await waitFor(
      () => {
        const first = JSON.stringify(snapshot(clients[0].doc));
        return clients.every((c) => JSON.stringify(snapshot(c.doc)) === first);
      },
      20_000
    );

    const finalIds = new Set(snapshot(clients[0].doc).map((n) => n.id));
    for (const id of finalIds) expect(created.has(id)).toBe(true);
    for (const id of created) {
      if (!deleted.has(id)) expect(finalIds.has(id)).toBe(true);
    }
    expect(finalIds.size).toBeGreaterThan(0);

    for (const client of clients) client.closeNow();
  });
});

describe('BoardRoom late join and resilience (TC-14, TC-15, TC-16, TC-18, TC-31)', () => {
  it('TC-14 a late joiner catches up with the full board', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);
    for (let i = 0; i < 10; i += 1) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: i * 10, y: 50 });
    }
    await a.waitForSync();
    await b.waitForSync();
    expect(a.snapshot()).toHaveLength(20);

    const late = await connectBoard(fetcher, boardId);
    await waitFor(() => late.snapshot().length === 20);
    expect(sortById(late.snapshot())).toEqual(sortById(a.snapshot()));

    a.closeNow();
    b.closeNow();
    late.closeNow();
  });

  const malformedCases: Array<[string, (client: RoomClient) => void]> = [
    ['unknown message type', (c) => c.sendRaw(new Uint8Array([99, 1, 2, 3]))],
    ['text frame', (c) => c.sendText('hello')],
    ['unknown sync subtype', (c) => c.sendRaw(new Uint8Array([MESSAGE_SYNC, 9]))],
    [
      'undecodable update content',
      (c) => c.sendRaw(new Uint8Array([MESSAGE_SYNC, 2, 5, 0xff, 0xff]))
    ]
  ];

  for (const [label, sendMalformed] of malformedCases) {
    it(`TC-15 (${label}) closes only the offending socket with 1003`, async () => {
      const boardId = newId();
      const a = await RoomClient.connect(
        fetcher,
        `https://example.com/api/rooms/${boardId}`
      );
      const b = await connectBoard(fetcher, boardId);
      const observer = await connectBoard(fetcher, boardId);

      const note = createSticky(a.doc, { x: 5, y: 5 });
      await waitFor(() => observer.snapshot().some((n) => n.id === note));
      const baseline = sortById(observer.snapshot());
      const bIndex = b.frames.length;

      await a.waitForSync();
      sendMalformed(a);
      expect(await a.waitForClosed()).toBe(CLOSE_UNSUPPORTED_DATA);
      await settle();

      // The room document is untouched by the malformed frame.
      const observer2 = await connectBoard(fetcher, boardId);
      expect(sortById(observer2.snapshot())).toEqual(baseline);

      // Sockets that stayed open keep working.
      const a2 = await connectBoard(fetcher, boardId);
      const note2 = createSticky(a2.doc, { x: 6, y: 6 });
      await waitFor(
        () =>
          b.snapshot().some((n) => n.id === note2) &&
          observer2.snapshot().some((n) => n.id === note2)
      );
      expect(b.newFramesSince(bIndex).length).toBeGreaterThan(0);

      b.closeNow();
      observer.closeNow();
      observer2.closeNow();
      a2.closeNow();
    });
  }

  it('TC-16 relays awareness frames verbatim to everyone', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_AWARENESS);
    const update = new Uint8Array([1, 64, 1, 112, 97, 114, 116, 121, 116, 101, 114]);
    writeVarUint8Array(encoder, update);
    const frame = toUint8Array(encoder);

    const indexA = a.frames.length;
    const indexB = b.frames.length;
    a.sendRaw(frame);

    await waitFor(
      () => a.frames.length > indexA && b.frames.length > indexB
    );
    const relayedA = a.newFramesSince(indexA)[0];
    const relayedB = b.newFramesSince(indexB)[0];
    expect(relayedA.type).toBe(MESSAGE_AWARENESS);
    expect(Array.from(relayedA.bytes)).toEqual(Array.from(frame));
    expect(Array.from(relayedB.bytes)).toEqual(Array.from(frame));

    a.closeNow();
    b.closeNow();
  });

  it('TC-18 a fresh room instance is repopulated from a reconnecting client', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);
    for (let i = 0; i < 3; i += 1) createSticky(a.doc, { x: i * 30, y: 0 });
    await a.waitForSync();
    await b.waitForSync();
    expect(b.snapshot()).toHaveLength(3);

    // Simulated restart: a brand-new BoardRoom (fresh object id) starts with
    // an empty doc and must recover everything from clients that reconnect.
    const freshBoardId = newBoardId();
    const freshUrl = `https://example.com/api/rooms/${freshBoardId}`;
    await a.reconnect(fetcher, freshUrl);
    await a.waitForSync();
    const observer = await connectBoard(fetcher, freshBoardId);
    await waitFor(() => observer.snapshot().length === 3);
    expect(sortById(observer.snapshot())).toEqual(sortById(a.snapshot()));

    await b.reconnect(fetcher, freshUrl);
    await waitFor(() => sortById(b.snapshot()).length === 3);
    expect(sortById(b.snapshot())).toEqual(sortById(a.snapshot()));

    a.closeNow();
    b.closeNow();
    observer.closeNow();
  });

  it('TC-31 survives sending to a socket that died between sync and broadcast', async () => {
    const boardId = newId();
    const a = await connectBoard(fetcher, boardId);
    const b = await connectBoard(fetcher, boardId);

    b.closeNow();
    const first = createSticky(a.doc, { x: 1, y: 1 });

    const c = await connectBoard(fetcher, boardId);
    await waitFor(() => c.snapshot().some((n) => n.id === first));
    const second = createSticky(a.doc, { x: 2, y: 2 });
    await waitFor(() => c.snapshot().length === 2);
    expect(a.snapshot()).toHaveLength(2);
    expect(c.snapshot().some((n) => n.id === second)).toBe(true);

    a.closeNow();
    c.closeNow();
  });
});
