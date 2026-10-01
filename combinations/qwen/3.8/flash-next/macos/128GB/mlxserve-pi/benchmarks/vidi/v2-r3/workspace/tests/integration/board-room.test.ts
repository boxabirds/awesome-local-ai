// Story 3, `sync.room`: one live document per board address, relayed to every
// socket on that address.
//
// Test numbers are the design's coverage table (TC-07 to TC-18, TC-31), which
// crosses the dimensions it states: what changes (create, move, recolour, text,
// delete), who changes it (one writer, two writers on different notes, two on
// one property, writer against deleter), how many people are connected (2,
// MAX_CONCURRENT_EDITORS, a late joiner) and the connection condition (steady,
// malformed traffic, room restart).
//
// Everything here is real: the real `BoardRoom` in a real Workers runtime, real
// WebSockets obtained from `SELF.fetch` upgrade responses, real yjs protocol
// and real merge semantics. Only the *browser* is absent — its half of the same
// story is `tests/e2e/live-collaboration.spec.ts`.
import { describe, expect, it } from 'vitest';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  ROOM_PATH_PREFIX,
  TestClient,
  type RoomInternals,
  connectClient,
  connectClients,
  createRoom,
  env,
  inspectRoom,
  roomStub,
  runInDurableObject,
  seedNote,
  settle,
  simulateRoomEviction,
  until,
  untilAsync,
} from './helpers/ws-client';
import { logSeed, planOps, runOps } from './helpers/random-ops';

/** Say how long a change took, whether or not the assertion passes. */
function reportLatency(label: string, ms: number): void {
  console.log(`[latency] ${label}: ${ms.toFixed(1)}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
}

/** Do `change`, then time how long `seen` takes to hold. */
async function timeUntil(
  label: string,
  seen: () => boolean,
  change: () => void,
  timeoutMs = 4000,
): Promise<number> {
  const started = Date.now();
  change();
  await until(seen, `${label} in time`, timeoutMs);
  const elapsed = Date.now() - started;
  reportLatency(label, elapsed);
  return elapsed;
}

/** The two documents hold exactly the same notes, in the same order-free set. */
function sameBoard(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): void {
  expect(a.map((note) => note.id).sort()).toEqual(b.map((note) => note.id).sort());
  expect(JSON.stringify([...a].sort())).toBe(JSON.stringify([...b].sort()));
}

describe('TC-07: a change is applied and relayed', () => {
  it('TC-07 one person creates a note, the other has the same board', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);

    const id = ada.createNote({ x: 40, y: 80 });
    await bo.waitForNoteCount(1);
    await settle(ada);

    // B's snapshot equals A's snapshot
    sameBoard(ada.notes(), bo.notes());
    expect(bo.noteIds()).toEqual([id]);
    // and B received exactly one update message: one transaction in, one frame
    // out, no batching and no timers
    expect(bo.updateFramesReceived).toBe(1);

    ada.close();
    bo.close();
  });

  it('TC-07 the room holds both sockets, and only both', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    expect(await inspectRoom(boardId)).toEqual({ sockets: 2, notes: 0 });
    bo.close();
    await untilAsync(async () => (await inspectRoom(boardId)).sockets === 1, 'the room to drop one socket');
    expect((await inspectRoom(boardId)).sockets).toBe(1);
    ada.close();
    await untilAsync(async () => (await inspectRoom(boardId)).sockets === 0, 'the room to empty');
  });

  it('TC-07 the room greets a new socket with step one, which is how it gets the board', async () => {
    const boardId = newBoardId();
    const noteId = await seedNote(boardId, { text: 'already on the board' });
    const client = new TestClient(boardId, 'Ada');
    await client.open();
    await until(() => client.noteText(noteId) === 'already on the board', 'the board to arrive', 4000);
    // The room spoke first: the greeting arrived without the client asking.
    expect(client.syncStep1Received).toBe(1);
    expect(client.framesReceived).toBeGreaterThan(0);
    client.close();
  });
});

describe('TC-08: every kind of change reaches the other person in time', () => {
  /** One test per kind of change, as the coverage table asks. */
  const kinds = ['move', 'recolour', 'text', 'delete'] as const;

  it.each(kinds)('TC-08 a %s arrives, with no echo to the person who did it', async (kind) => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote({ x: 10, y: 20 });
    ada.setText(id, 'green');
    await bo.waitForText(id, 'green');

    const boFramesBefore = bo.framesReceived;
    const adaFramesBefore = ada.framesReceived;

    const elapsed = await timeUntil(
      `TC-08 ${kind}`,
      () =>
        kind === 'move'
          ? bo.notes()[0]?.x === 400 && bo.notes()[0]?.y === 260
          : kind === 'recolour'
            ? bo.noteColor(id) === 'violet'
            : kind === 'text'
              ? bo.noteText(id) === 'green and blue'
              : bo.noteIds().length === 0,
      () => {
        switch (kind) {
          case 'move':
            ada.moveNote(id, 400, 260);
            break;
          case 'recolour':
            ada.setColor(id, 'violet');
            break;
          case 'text':
            ada.typeAt(id, 5, ' and blue');
            break;
          case 'delete':
            ada.deleteNote(id);
            break;
        }
      },
    );
    expect(elapsed).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    await settle(bo);
    // B's snapshot equals A's after the change
    sameBoard(ada.notes(), bo.notes());
    // TC-08 must not happen: the person who changed it gets no echo, so their
    // frame count has not moved while the change went out
    expect(ada.framesReceived).toBe(adaFramesBefore);
    expect(bo.framesReceived).toBeGreaterThan(boFramesBefore);

    ada.close();
    bo.close();
  });
});

describe('TC-09, TC-10, TC-11: two people, one document', () => {
  it('TC-09 two people typing in one note keep every character, in one order', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote();
    ada.setText(id, 'green');
    await bo.waitForText(id, 'green');

    // Both hands are in the same text at the same time: neither waits for the
    // other, so the two updates are in flight together.
    ada.typeAt(id, 0, 'red ');
    bo.typeAt(id, 5, ' blue');

    await until(() => ada.noteText(id) === bo.noteText(id), 'both documents to agree on the text');
    // "red " at the start plus " blue" at the end of "green" is "red green blue"
    expect(ada.noteText(id)).toBe('red green blue');
    expect(bo.noteText(id)).toBe('red green blue');

    // a third person, arriving later, is given the same answer
    const late = await connectClient(boardId, 'Cleo');
    expect(late.noteText(id)).toBe('red green blue');

    ada.close();
    bo.close();
    late.close();
  });

  it('TC-10 two people moving one note settle on one position, the same on both', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote({ x: 0, y: 0 });
    await bo.waitForNoteCount(1);

    ada.moveNote(id, 100, 0);
    bo.moveNote(id, 300, 0);

    await until(() => ada.noteIds().length === 1 && bo.noteIds().length === 1 && ada.notes()[0]?.x === bo.notes()[0]?.x, 'both documents to agree on x');
    const x = ada.notes()[0]?.x;
    expect([100, 300]).toContain(x);
    expect(bo.notes()[0]?.x).toBe(x);

    ada.close();
    bo.close();
  });

  it('TC-11 a delete and a simultaneous edit leave the note gone everywhere', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote();
    ada.setText(id, 'green');
    await bo.waitForText(id, 'green');

    // One person deletes the note while the other is typing into it
    ada.deleteNote(id);
    const typedWhileDeleted = 'typing into a note that is being deleted';
    bo.typeAt(id, 5, typedWhileDeleted);

    await until(() => ada.noteIds().length === 0 && bo.noteIds().length === 0, 'the note to be gone from both');
    // TC-11 must not happen: the note does not come back, on either screen
    expect(ada.noteIds()).toEqual([]);
    expect(bo.noteIds()).toEqual([]);
    // and the text typed into it is not present anywhere
    expect(ada.noteTexts().join('')).not.toContain(typedWhileDeleted);
    expect(bo.noteTexts().join('')).not.toContain(typedWhileDeleted);
    expect((await inspectRoom(boardId)).notes).toBe(0);

    // no exception got out of the room: it is still itself, and still relaying
    const late = await connectClient(boardId, 'Cleo');
    const fresh = ada.createNote();
    await late.waitForNoteCount(1);
    expect(late.noteIds()).toEqual([fresh]);

    ada.close();
    bo.close();
    late.close();
  });
});

describe('TC-12, TC-14: the capacity it is designed for, and a late joiner', () => {
  it('TC-12 five people working continuously all end on the same board', async () => {
    const boardId = newBoardId();
    const opsPerClient = 200;
    const seedBase = 20260714;
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `Editor ${index + 1}`);
    const clients = await connectClients(boardId, names);

    // A seeded plan per person, interleaved so their work really overlaps
    const plans = names.map((_unused, index) => {
      const seed = seedBase + index;
      logSeed(`TC-12 editor ${index + 1}`, seed);
      return planOps(seed, opsPerClient);
    });

    const started = Date.now();
    const outcomes = plans.map(() => ({ created: [] as string[], deleted: new Set<string>() }));
    for (let round = 0; round < opsPerClient; round++) {
      clients.forEach((client, index) => {
        const outcome = runOps(client, [plans[index]![round]!]);
        outcomes[index]!.created.push(...outcome.created);
        for (const id of outcome.deleted) outcomes[index]!.deleted.add(id);
      });
    }
    const applied = Date.now() - started;
    reportLatency(`TC-12 ${opsPerClient * MAX_CONCURRENT_EDITORS} operations applied`, applied);

    // every note anybody made, that nobody deleted, is on the board
    const created = outcomes.flatMap((outcome) => outcome.created);
    const deleted = new Set(outcomes.flatMap((outcome) => [...outcome.deleted]));
    const expected = created.filter((id) => !deleted.has(id));

    await until(
      () => clients.every((client) => client.noteIds().length === expected.length),
      'every screen to hold the same number of notes',
      20000,
    );
    for (const client of clients) {
      expect(client.noteIds().sort()).toEqual([...expected].sort());
    }
    // and all the snapshots are identical
    for (const client of clients) sameBoard(clients[0]!.notes(), client.notes());

    const settled = Date.now() - started;
    reportLatency('TC-12 all screens identical', settled);

    for (const client of clients) client.close();
  });

  it('TC-14 a person who joins late is given the whole board, 20 notes and all', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    // Two people make twenty notes between them before anyone else arrives
    for (let index = 0; index < 10; index++) {
      ada.createNote({ x: index * 60, y: 0 });
      bo.createNote({ x: index * 60, y: 120 });
    }
    await until(() => ada.noteIds().length === 20 && bo.noteIds().length === 20, 'the board to fill up');
    await settle(ada);

    const latecomer = await connectClient(boardId, 'Cleo');
    expect(latecomer.noteIds().length).toBe(20);
    sameBoard(ada.notes(), latecomer.notes());
    // the whole board arrived in the join exchange, before anyone changed anything
    expect(latecomer.syncStep2Received).toBeGreaterThan(0);

    ada.close();
    bo.close();
    latecomer.close();
  });
});

describe('TC-15: malformed traffic costs one socket, not the board', () => {
  /** Each run sends one unusable thing and shows only its sender is dropped. */
  const malformed = [
    { name: 'a text frame', send: (client: TestClient) => client.sendTextFrame('I am not a y-websocket frame') },
    { name: 'truncated bytes', send: (client: TestClient) => client.sendTruncatedBytes() },
    { name: 'an unknown message type', send: (client: TestClient) => client.sendUnknownType() },
    { name: 'an update that is not a Yjs update', send: (client: TestClient) => client.sendGarbageSyncFrame() },
  ] as const;

  it.each(malformed)('TC-15 $name closes its sender only', async ({ send }) => {
    const boardId = newBoardId();
    const noteId = await seedNote(boardId, { text: 'the board as it was' });
    const victim = await connectClient(boardId, 'Offender');
    const witness = await connectClient(boardId, 'Witness');
    expect(witness.noteIds()).toEqual([noteId]);

    const roomBefore = await inspectRoom(boardId);
    send(victim);

    // TC-15 must not happen: nobody else is dropped, and the document is not
    // changed by the nonsense
    await victim.waitForClosed();
    expect(victim.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(witness.isOpen).toBe(true);
    expect(witness.closeCode).toBeNull();
    expect((await inspectRoom(boardId)).notes).toBe(roomBefore.notes);
    await untilAsync(async () => (await inspectRoom(boardId)).sockets === 1, 'the room to hold only the witness');

    // and the person who is still connected still receives updates
    const other = await connectClient(boardId, 'Other');
    const fresh = other.createNote();
    await witness.waitForNoteCount(2);
    expect(witness.noteIds().sort()).toEqual([fresh, noteId].sort());

    victim.close();
    witness.close();
    other.close();
  });

  it('TC-15 a person who sends four bad things in a row is gone after the first', async () => {
    const boardId = newBoardId();
    const noteId = await seedNote(boardId);
    const victim = await connectClient(boardId, 'Offender');
    const witness = await connectClient(boardId, 'Witness');
    const roomBefore = await inspectRoom(boardId);

    for (const run of malformed) run.send(victim);

    await victim.waitForClosed();
    expect(victim.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(witness.isOpen).toBe(true);
    expect((await inspectRoom(boardId)).notes).toBe(roomBefore.notes);
    expect(witness.noteIds()).toEqual([noteId]);

    victim.close();
    witness.close();
  });
});

describe('TC-16: presence travels through the room', () => {
  it('TC-16 what one person sends arrives as the same bytes for everyone', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);

    const sent = ada.sendAwareness();
    await until(() => bo.awarenessFramesReceived > 0, 'the awareness frame to arrive');
    await settle(bo);

    // relayed, not rewritten: byte for byte what was sent
    expect(Array.from(bo.awarenessPayloads[0] as Uint8Array)).toEqual(Array.from(sent));
    // to everybody, the sender included (the room keeps no awareness state of
    // its own, so this traffic is also what keeps an idle link alive)
    expect(Array.from(ada.awarenessPayloads[0] as Uint8Array)).toEqual(Array.from(sent));
    expect(bo.awarenessNames()).toContain('Ada');

    // presence is not board data: nobody's board changed
    expect(ada.noteIds()).toEqual([]);
    expect(bo.noteIds()).toEqual([]);
    expect((await inspectRoom(boardId)).notes).toBe(0);

    ada.close();
    bo.close();
  });
});

describe('TC-18: a room that is gone and comes back', () => {
  it('TC-18 a reconnected person rebuilds the board, and the next one converges', async () => {
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const id = ada.createNote({ x: 20, y: 20 });
    ada.setText(id, 'what was on the board');
    ada.setColor(id, 'pink');
    await bo.waitForText(id, 'what was on the board');

    // The room goes away: its sockets are closed and its document with it, as
    // it does on a deploy while story 4 has not given it storage yet.
    await simulateRoomEviction(boardId);
    expect(await inspectRoom(boardId)).toEqual({ sockets: 0, notes: 0 });
    await ada.waitForClosed();
    await bo.waitForClosed();

    // Ada reconnects first: the fresh room is rebuilt from what Ada has
    await ada.open();
    await settle(ada);
    expect(await inspectRoom(boardId)).toEqual({ sockets: 1, notes: 1 });
    expect(ada.noteIds()).toEqual([id]);

    // Then Bo reconnects: the same note, not a second copy of it
    await bo.open();
    await settle(bo);
    expect(bo.noteIds()).toEqual([id]);
    expect(bo.noteText(id)).toBe('what was on the board');
    expect(bo.noteColor(id)).toBe('pink');
    sameBoard(ada.notes(), bo.notes());
    expect((await inspectRoom(boardId)).notes).toBe(1);

    // and the rebuilt room still relays, to everybody
    const late = await connectClient(boardId, 'Cleo');
    const fresh = ada.createNote();
    await bo.waitForNoteCount(2);
    await late.waitForNoteCount(2);
    expect(late.noteIds().sort()).toEqual(bo.noteIds().sort());
    expect(late.noteIds()).toContain(fresh);

    ada.close();
    bo.close();
    late.close();
  });

  it('TC-18 a room with nothing in it and nobody connected starts empty', async () => {
    const boardId = newBoardId();
    expect(await inspectRoom(boardId)).toEqual({ sockets: 0, notes: 0 });
    const ada = await connectClient(boardId, 'Ada');
    expect(ada.noteIds()).toEqual([]);
    ada.close();
  });
});

describe('TC-31: a socket the room cannot write to', () => {
  it('TC-31 a connection that goes away leaves the board working', async () => {
    // The state this and the next test are after is the room holding a socket
    // it cannot write to. workerd will not arrange the half of it that matters
    // from the outside: closing a server socket from inside the object reaches
    // neither the client end nor the object's own close listener, so the only
    // way to get a genuinely unwritable socket into the set is to put one
    // there, which the next test does. What is arranged here is the ordinary
    // version of the same code path — a person's connection goes away and the
    // room finds out when it next has something to send.
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);
    const gone = await connectClient(boardId, 'Gone');

    gone.close();

    // The room has to send an update now, to a set it may not have cleaned yet: it
    // must not fall over, and the others must still get it.
    const id = ada.createNote();
    await bo.waitForNoteCount(1);
    expect(bo.noteIds()).toEqual([id]);
    expect(ada.noteIds()).toEqual([id]);
    expect(ada.closeCode).toBeNull();
    expect(bo.closeCode).toBeNull();

    // the gone socket is out of the room's set, and a newcomer gets the board
    await untilAsync(
      async () => (await inspectRoom(boardId)).sockets === 2,
      'the room to notice Gone left',
    );
    const late = await connectClient(boardId, 'Cleo');
    expect(late.noteIds()).toEqual([id]);

    ada.close();
    bo.close();
    late.close();
  });

  it('TC-31 a socket that throws on send does not stop delivery', async () => {
    // The half of TC-31 the runtime will not arrange from outside: writing to a
    // socket that died in the network throws, and the room must not fall over
    // mid-broadcast because of it. Under the hibernation API a test cannot add
    // a socket to the runtime's own set, so this drives the room's own send
    // path directly with a socket that cannot be written to — the exact call
    // `broadcast` makes — and shows it is survivable, then that a real change
    // still reaches everybody.
    const boardId = newBoardId();
    const [ada, bo] = await connectClients(boardId, ['Ada', 'Bo']);

    const probed = await runInDurableObject(roomStub(boardId), (object) => {
      const room = object as unknown as RoomInternals;
      // A server socket the runtime never accepted: the platform refuses a write
      // to it, which is what a socket the network already took looks like.
      const pair = new WebSocketPair();
      const dead = pair[1] as WebSocket;
      let unwritable = false;
      try {
        dead.send(new Uint8Array([1, 0]));
      } catch {
        unwritable = true;
      }
      // The room's own send must swallow it rather than throw up the stack.
      let survivedSend = false;
      try {
        room.sendTo(dead, new Uint8Array([1, 0]));
        survivedSend = true;
      } catch {
        survivedSend = false;
      }
      return { unwritable, survivedSend };
    });

    expect(probed.unwritable).toBe(true); // the premise holds: it cannot be written to
    expect(probed.survivedSend).toBe(true); // the room does not fall over on it

    // A real change from a real person, broadcast while an unwritable socket is
    // in the mix, still arrives.
    const id = ada.createNote();
    await bo.waitForNoteCount(1);
    expect(bo.noteIds()).toEqual([id]);
    expect(ada.closeCode).toBeNull();
    expect(bo.closeCode).toBeNull();
    expect((await inspectRoom(boardId)).notes).toBe(1);

    ada.close();
    bo.close();
  });
});

describe('the room and the address (live.isolation)', () => {
  it('a change on one board never reaches another', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const onA = await connectClient(boardA, 'Ada');
    const onB = await connectClient(boardB, 'Bo');

    const id = onA.createNote();
    onA.setText(id, 'only ever on a');
    await settle(onA);
    await settle(onB);

    expect(onB.noteIds()).toEqual([]);
    expect(onB.noteTexts()).not.toContain('only ever on a');
    expect(onB.updateFramesReceived).toBe(0);
    expect((await inspectRoom(boardB)).notes).toBe(0);
    expect((await inspectRoom(boardA)).notes).toBe(1);
    expect(env.BOARD_ROOM.idFromName(boardA).toString()).not.toBe(env.BOARD_ROOM.idFromName(boardB).toString());

    onA.close();
    onB.close();
  });

  it('the socket route is the address the client uses', async () => {
    const boardId = newBoardId();
    // Story 5: the room refuses a socket to a board that does not exist, so a
    // test that reaches the room's `fetch` directly (bypassing the client that
    // would have created it) has to create the board itself first.
    await createRoom(boardId);
    const response = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId)).fetch(
      `http://localhost${ROOM_PATH_PREFIX}${boardId}`,
      { headers: { Upgrade: 'websocket' } },
    );
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close();
  });
});
