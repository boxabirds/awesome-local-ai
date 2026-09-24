import { env, runInDurableObject } from 'cloudflare:test';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';
import { insertText, randomOp, seededRandom, type OpLog } from './random-ops';
import { docJson, eventually, join, type TestClient } from './ws-client';

const NOTE_AT = { x: 0, y: 0 } as const;
const LATE_JOIN_NOTES = 20;
const RANDOM_OPS_PER_CLIENT = 200;
/** Let messages flow every few operations so edits interleave with remote updates. */
const OPS_BETWEEN_FLUSHES = 7;
const CONCURRENT_X = { a: 100, b: 300 } as const;
const INVALID_YJS_UPDATE = new Uint8Array([255, 255, 255, 255, 255]);
const UNKNOWN_TYPE = 9;
const AWARENESS_BYTES = new Uint8Array([MESSAGE_AWARENESS, 3, 1, 2, 3]);
/**
 * Since story 4 every update is written to storage before it is broadcast, and each write's
 * commit gates the room's output: 1,000 random ops take seconds rather than milliseconds.
 */
const RANDOM_OPS_TIMEOUT_MS = 60_000;

function closeAll(...clients: TestClient[]): void {
  clients.forEach((c) => c.close());
}

async function pair(): Promise<{ a: TestClient; b: TestClient; boardId: string }> {
  const boardId = newBoardId();
  const a = await join(boardId);
  const b = await join(boardId);
  return { a, b, boardId };
}

/** Waits until every client's document equals the first one's. */
async function converged(...clients: TestClient[]): Promise<void> {
  await eventually(() => {
    const expected = docJson(clients[0]!.doc);
    for (const c of clients.slice(1)) expect(docJson(c.doc)).toEqual(expected);
  });
}

/** Sends every client's round trip so all in-flight frames have been processed. */
async function settle(...clients: TestClient[]): Promise<void> {
  for (const c of clients) await c.barrier();
  for (const c of clients) await c.barrier();
}

describe('sync.room broadcast', () => {
  it('TC-07 a created note reaches B as exactly one update message', async () => {
    const { a, b } = await pair();
    const before = b.updateCount();
    createSticky(a.doc, NOTE_AT);
    await converged(a, b);
    await settle(a, b);
    expect(snapshot(b.doc)).toEqual(snapshot(a.doc));
    expect(b.updateCount() - before).toBe(1);
    closeAll(a, b);
  });

  describe('TC-08 each kind of change reaches B and is never echoed to A', () => {
    const kinds: [string, (doc: Y.Doc, id: string) => void][] = [
      ['move', (doc, id) => moveObject(doc, id, 400, -250)],
      ['recolour', (doc, id) => setStickyColor(doc, id, 'pink')],
      [
        'text insert',
        (doc, id) => {
          insertText(doc, id, 0, 'Pricing');
        },
      ],
      ['delete', (doc, id) => deleteObject(doc, id)],
    ];
    for (const [name, mutate] of kinds) {
      it(name, async () => {
        const { a, b } = await pair();
        const id = createSticky(a.doc, NOTE_AT);
        await converged(a, b);
        await settle(a, b);
        const echoesBefore = a.updateCount();
        mutate(a.doc, id);
        await converged(a, b);
        await settle(a, b);
        expect(snapshot(b.doc)).toEqual(snapshot(a.doc));
        expect(a.updateCount()).toBe(echoesBefore);
        closeAll(a, b);
      });
    }
  });
});

describe('sync.room merging', () => {
  it("TC-09 concurrent typing: 'red ' at the start and ' blue' at the end of 'green'", async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, NOTE_AT);
    insertText(a.doc, id, 0, 'green');
    await converged(a, b);

    a.hold();
    b.hold();
    const textA = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;
    insertText(a.doc, id, 0, 'red ');
    insertText(b.doc, id, textB.length, ' blue');
    a.release();
    b.release();

    await eventually(() => {
      expect(textA.toString()).toBe('red green blue');
      expect(textB.toString()).toBe('red green blue');
    });
    closeAll(a, b);
  });

  it('TC-10 concurrent x=100 and x=300 settle to one value on both', async () => {
    const { a, b } = await pair();
    const id = createSticky(a.doc, NOTE_AT);
    await converged(a, b);

    a.hold();
    b.hold();
    moveObject(a.doc, id, CONCURRENT_X.a, 0);
    moveObject(b.doc, id, CONCURRENT_X.b, 0);
    a.release();
    b.release();

    await converged(a, b);
    await settle(a, b);
    const xa = snapshot(a.doc)[0]!.x;
    expect(xa).toBe(snapshot(b.doc)[0]!.x);
    expect([CONCURRENT_X.a, CONCURRENT_X.b]).toContain(xa);
    closeAll(a, b);
  });

  it('TC-11 delete wins over concurrent typing and the note never comes back', async () => {
    const { a, b, boardId } = await pair();
    const id = createSticky(a.doc, NOTE_AT);
    await converged(a, b);

    a.hold();
    b.hold();
    expect(deleteObject(a.doc, id)).toBe(true);
    insertText(b.doc, id, 0, 'lost words');
    a.release();
    b.release();

    await converged(a, b);
    await settle(a, b);
    expect(snapshot(a.doc)).toHaveLength(0);
    expect(snapshot(b.doc)).toHaveLength(0);
    expect(JSON.stringify(docJson(a.doc))).not.toContain('lost words');

    // The room agrees: a late joiner sees no note and none of B's text.
    const c = await join(boardId);
    expect(snapshot(c.doc)).toHaveLength(0);
    expect(JSON.stringify(docJson(c.doc))).not.toContain('lost words');
    closeAll(a, b, c);
  });

  it(`TC-12 ${MAX_CONCURRENT_EDITORS} clients × ${RANDOM_OPS_PER_CLIENT} seeded random ops converge`, async () => {
    const seed = Date.now() >>> 0;
    console.info(`TC-12 seed ${seed}`);
    const rand = seededRandom(seed);
    const boardId = newBoardId();
    const clients: TestClient[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) clients.push(await join(boardId));
    const log: OpLog = { created: new Set(), deleted: new Set() };

    const total = MAX_CONCURRENT_EDITORS * RANDOM_OPS_PER_CLIENT;
    const done = new Array<number>(MAX_CONCURRENT_EDITORS).fill(0);
    for (let n = 0; n < total; n += 1) {
      let i = Math.floor(rand() * MAX_CONCURRENT_EDITORS);
      while (done[i]! >= RANDOM_OPS_PER_CLIENT) i = (i + 1) % MAX_CONCURRENT_EDITORS;
      done[i]! += 1;
      randomOp(clients[i]!.doc, rand, log);
      if (n % OPS_BETWEEN_FLUSHES === 0) await clients[i]!.barrier();
    }

    await converged(...clients);
    await settle(...clients);
    const expected = docJson(clients[0]!.doc);
    for (const c of clients) expect(docJson(c.doc)).toEqual(expected);
    const expectedIds = [...log.created].filter((id) => !log.deleted.has(id)).sort();
    expect(snapshot(clients[0]!.doc).map((n) => n.id).sort()).toEqual(expectedIds);
    closeAll(...clients);
  }, RANDOM_OPS_TIMEOUT_MS);

  it(`TC-14 a late joiner receives all ${LATE_JOIN_NOTES} notes`, async () => {
    const { a, b, boardId } = await pair();
    for (let i = 0; i < LATE_JOIN_NOTES; i += 1) {
      const author = i % 2 === 0 ? a : b;
      const id = createSticky(author.doc, { x: i * 10, y: i * 5 }, i % 3 === 0 ? 'blue' : 'green');
      insertText(author.doc, id, 0, `note ${i}`);
    }
    await converged(a, b);
    const c = await join(boardId);
    expect(snapshot(c.doc)).toHaveLength(LATE_JOIN_NOTES);
    expect(docJson(c.doc)).toEqual(docJson(a.doc));
    closeAll(a, b, c);
  });
});

describe('sync.room errors and relays', () => {
  const syncFrame = (write: (e: encoding.Encoder) => void) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    write(e);
    return encoding.toUint8Array(e);
  };
  const malformed: [string, () => ArrayBuffer | Uint8Array | string][] = [
    ['text frame', () => 'hello'],
    ['truncated bytes', () => new Uint8Array([MESSAGE_SYNC, syncProtocol.messageYjsUpdate, 10, 1])],
    ['unknown type', () => new Uint8Array([UNKNOWN_TYPE])],
    ['invalid Yjs update', () => syncFrame((e) => syncProtocol.writeUpdate(e, INVALID_YJS_UPDATE))],
    [
      'invalid state vector',
      () =>
        syncFrame((e) => {
          encoding.writeVarUint(e, syncProtocol.messageYjsSyncStep1);
          encoding.writeVarUint8Array(e, INVALID_YJS_UPDATE);
        }),
    ],
  ];
  for (const [name, bytes] of malformed) {
    it(`TC-15 ${name}: sender closed with CLOSE_UNSUPPORTED_DATA, others unaffected`, async () => {
      const boardId = newBoardId();
      const a = await join(boardId);
      const b = await join(boardId);
      const writer = await join(boardId);
      createSticky(writer.doc, NOTE_AT);
      await converged(writer, a, b);
      const before = docJson(b.doc);

      a.sendRaw(bytes());
      expect(await a.closed).toBe(CLOSE_UNSUPPORTED_DATA);

      // Room document unchanged: a fresh joiner sees exactly what B had.
      const probe = await join(boardId);
      expect(docJson(probe.doc)).toEqual(before);

      // B is still connected and still receives updates.
      expect(b.isOpen()).toBe(true);
      createSticky(writer.doc, { x: 500, y: 500 });
      await eventually(() => expect(snapshot(b.doc)).toHaveLength(2));
      closeAll(b, writer, probe);
    });
  }

  it('TC-16 awareness bytes are relayed verbatim to every socket including the sender', async () => {
    const { a, b } = await pair();
    a.sendRaw(AWARENESS_BYTES);
    const awarenessOf = (c: TestClient) =>
      c.received.filter((m) => m.type === 'awareness').map((m) => Array.from(m.bytes));
    await eventually(() => {
      expect(awarenessOf(a)).toEqual([Array.from(AWARENESS_BYTES)]);
      expect(awarenessOf(b)).toEqual([Array.from(AWARENESS_BYTES)]);
    });
    closeAll(a, b);
  });

  // Story 4 changed the restart half of this case: the restarted room now reloads the board
  // from storage instead of starting empty. Repopulation of what the room lacks is unchanged.
  it('TC-18 after a room restart the room reloads the board; a reconnecting client adds what it lacks; B converges', async () => {
    const { a, b, boardId } = await pair();
    createSticky(a.doc, NOTE_AT);
    await converged(a, b);

    // Restart: every socket closes and the object instance is discarded (in-memory doc lost).
    closeAll(a, b);
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    await runInDurableObject(stub, (_instance, state) => {
      try {
        state.abort('restart');
      } catch {
        // abort() throws in the calling context by design.
      }
    }).catch(() => undefined);
    const reloaded = await join(boardId);
    expect(docJson(reloaded.doc)).toEqual(docJson(a.doc));
    reloaded.close();

    // B changed something while disconnected, which A lacks.
    const extra = createSticky(b.doc, { x: 300, y: 300 });

    const a2 = await join(boardId, a.doc);
    await settle(a2);
    const probe = await join(boardId);
    expect(docJson(probe.doc)).toEqual(docJson(a.doc));

    const b2 = await join(boardId, b.doc);
    await converged(a2, b2, probe);
    expect(snapshot(a2.doc).map((n) => n.id)).toContain(extra);
    expect(snapshot(a2.doc)).toHaveLength(2);
    closeAll(a2, b2, probe);
  });

  it('TC-31 a dead socket does not break the room', async () => {
    const boardId = newBoardId();
    const a = await join(boardId);
    const b = await join(boardId);
    // Abrupt close from B's side; the room may not have processed it before A's update.
    b.ws.close();
    createSticky(a.doc, NOTE_AT);
    const late = await join(boardId);
    expect(snapshot(late.doc)).toHaveLength(1);
    createSticky(a.doc, { x: 200, y: 0 });
    await eventually(() => expect(snapshot(late.doc)).toHaveLength(2));
    closeAll(a, late);
  });
});
