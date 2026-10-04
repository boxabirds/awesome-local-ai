/**
 * BoardRoom: the room that relays edits between the people on one board.
 *
 * Real Durable Objects, real WebSockets, real Yjs documents - the room itself is the thing
 * under test, so nothing about it is faked. Tests in here never hand-write a board id, and
 * every one of them hangs up its sockets at the end.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model.js';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol.js';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';
import {
  Participant,
  boardId,
  createBoardNamed,
  encodeFrame,
  encodeSync,
  env,
  framePayload,
  waitForConvergence,
  type ReceivedFrame,
} from './helpers/ws-client.js';
import { updateOfNote } from '../fixtures/boards.js';
import { ScriptedEditor } from './helpers/random-ops.js';
import { boardStub, insideBoard, selectRows } from './helpers/storage.js';

/** The tables a board's storage holds; empty means nothing was ever written here. */
async function tablesIn(name: string): Promise<string[]> {
  const rows = await selectRows(
    boardStub(name),
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return rows.map((row) => String(row['name']));
}

/** Give a board its storage, by the name the test chose (what `POST /api/boards` does). */
function makeBoard(name: string): Promise<'created' | 'exists'> {
  return createBoardNamed(name);
}

/**
 * Take the socket a room handed over and hang up.
 *
 * A response that carries a WebSocket has one that has not been accepted yet, and workerd insists
 * on it being dealt with one way or the other before the test moves on.
 */
function hangUp(response: Response): void {
  const socket = response.webSocket;
  if (socket !== null && socket !== undefined) {
    socket.accept();
    socket.close();
  }
}

/** The text of the first note on the board, or null when there is none. */
function firstText(participant: Participant): string | null {
  const [note] = participant.snapshot();
  return note === undefined ? null : note.text;
}

/** The id of the only note on a participant's board. */
function onlyNote(participant: Participant): string {
  const [note] = participant.snapshot();
  if (note === undefined) {
    throw new Error('expected exactly one note');
  }
  return note.id;
}

/** The bytes a frame carries, as plain numbers so they can be compared. */
function payloadBytes(frame: ReceivedFrame | undefined): number[] {
  const payload = frame === undefined ? null : framePayload(frame);
  if (payload === null) {
    throw new Error('frame carries no payload');
  }
  return Array.from(payload);
}

/**
 * One board, the people on it, and a `close()` that hangs up every socket. Each test makes its
 * own board, so no test ever shares a room with another.
 */
class Board {
  /** A board id nobody has used before. */
  readonly id = boardId();

  /**
   * The object instance this board's id lives in once {@link restart} has been called - a new
   * id, so a fresh instance with nothing in it. Named once, at construction, so that everybody
   * who comes back afterwards reaches the *same* fresh instance.
   */
  private readonly nextInstance = boardId();

  private readonly people: Participant[] = [];

  /** A person opening this board in their browser. */
  async join(): Promise<Participant> {
    const person = await new Participant().connect(this.id);
    this.people.push(person);
    return person;
  }

  /**
   * The board's id in a fresh instance of the room object, with no document in it: what a
   * restart looks like from outside. Existing people keep their documents and reconnect to it.
   */
  restart(): void {
    this.close();
  }

  /** A person reaching the restarted room, empty-handed. */
  async joinRestartedRoom(): Promise<Participant> {
    const person = await new Participant().connectStub(env.BOARD_ROOM, this.nextInstance);
    this.people.push(person);
    return person;
  }

  /**
   * Put an existing person's document on the restarted room's socket. The person keeps its
   * document, its edits and its identity; only the socket is new, as after any reconnect.
   */
  async reconnectToRestartedRoom(person: Participant): Promise<Participant> {
    return person.connectStub(env.BOARD_ROOM, this.nextInstance);
  }

  close(): void {
    for (const person of this.people) {
      person.close();
    }
  }
}

describe('TC-07 one person creates, the other sees it', () => {
  it('relays the new note exactly once, and does not echo it back to its author', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);

      createSticky(alex.doc, { x: 20, y: 40 });

      await waitForConvergence([alex, sam]);
      expect(sam.snapshot()).toHaveLength(1);
      expect(sam.snapshot()).toEqual(alex.snapshot());
      // Exactly one update message carried the note - not a re-sync, not a per-property drip.
      expect(sam.updateFrames()).toHaveLength(1);
      // And the author did not get its own edit back.
      expect(alex.updateFrames()).toHaveLength(0);
    } finally {
      board.close();
    }
  });
});

describe('TC-08 one person edits, the other sees every kind of change', () => {
  const kinds: Record<string, (doc: Y.Doc, note: string) => void> = {
    move: (doc, note) => {
      moveObject(doc, note, 300, -120);
    },
    recolour: (doc, note) => {
      setStickyColor(doc, note, 'violet');
    },
    'text insert': (doc, note) => {
      getStickyText(doc, note)?.insert(0, 'typed ');
    },
    delete: (doc, note) => {
      deleteObject(doc, note);
    },
  };

  it.each(Object.entries(kinds))('%s', async (_name, mutate) => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      createSticky(alex.doc, { x: 10, y: 20 });
      await waitForConvergence([alex, sam]);
      // Sam has already taken the note itself; only what arrives after this is the edit.
      const seen = sam.updateFrames().length;

      mutate(alex.doc, onlyNote(alex));

      await waitForConvergence([alex, sam]);
      expect(sam.snapshot()).toEqual(alex.snapshot());
      expect(sam.updateFrames().length).toBe(seen + 1);
      // The room answers other people's edits, never the sender's own.
      expect(alex.updateFrames()).toHaveLength(0);
    } finally {
      board.close();
    }
  });
});

describe('TC-09 both people type in the same note at the same time', () => {
  it('merges both inserts into one text on both boards', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      createSticky(alex.doc, { x: 0, y: 0 });
      getStickyText(alex.doc, onlyNote(alex))?.insert(0, 'green');
      await waitForConvergence([alex, sam]);

      // Both edit before either has heard of the other.
      alex.mute();
      sam.mute();
      getStickyText(alex.doc, onlyNote(alex))?.insert(0, 'red ');
      getStickyText(sam.doc, onlyNote(sam))?.insert(5, ' blue');
      alex.unmute();
      sam.unmute();

      await waitForConvergence([alex, sam]);
      expect(firstText(alex)).toBe('red green blue');
      expect(firstText(sam)).toBe('red green blue');
    } finally {
      board.close();
    }
  });
});

describe('TC-10 both people move the same note at the same time', () => {
  it('leaves both boards agreeing on one of the two positions', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      createSticky(alex.doc, { x: 0, y: 0 });
      await waitForConvergence([alex, sam]);

      alex.mute();
      sam.mute();
      moveObject(alex.doc, onlyNote(alex), 100, 0);
      moveObject(sam.doc, onlyNote(sam), 300, 0);
      alex.unmute();
      sam.unmute();

      await waitForConvergence([alex, sam]);
      const [alexsNote] = alex.snapshot();
      const [samsNote] = sam.snapshot();
      expect(alexsNote?.x).toBe(samsNote?.x);
      expect([100, 300]).toContain(alexsNote?.x);
    } finally {
      board.close();
    }
  });
});

describe('TC-11 one person deletes while the other types in that note', () => {
  it('leaves the note gone on both boards, with the typing not coming back', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      createSticky(alex.doc, { x: 0, y: 0 });
      getStickyText(alex.doc, onlyNote(alex))?.insert(0, 'keep');
      await waitForConvergence([alex, sam]);

      alex.mute();
      sam.mute();
      deleteObject(alex.doc, onlyNote(alex));
      getStickyText(sam.doc, onlyNote(sam))?.insert(0, 'typed-after-delete');
      alex.unmute();
      sam.unmute();

      await waitForConvergence([alex, sam]);
      expect(alex.snapshot()).toEqual([]);
      expect(sam.snapshot()).toEqual([]);
      expect(alex.textMentions('typed-after-delete')).toBe(false);
      expect(sam.textMentions('typed-after-delete')).toBe(false);
      // Neither side was thrown out of the room by the collision.
      expect(alex.log.closed).toBe(false);
      expect(sam.log.closed).toBe(false);

      // And it does not come back for someone who joins later.
      const late = await board.join();
      await waitForConvergence([alex, sam, late]);
      expect(late.snapshot()).toEqual([]);
    } finally {
      board.close();
    }
  });
});

describe('TC-12 the whole board edits at once', () => {
  it(
    'converges with MAX_CONCURRENT_EDITORS people running 200 operations each',
    async () => {
      const board = new Board();
      try {
        const people: Participant[] = [];
        for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
          people.push(await board.join());
        }
        await waitForConvergence(people);

        const scripts = people.map(
          (person, index) => new ScriptedEditor(person.doc, 0x5eed + index * 7919),
        );
        const operations = 200;
        for (let round = 0; round < operations; round += 1) {
          for (const script of scripts) {
            script.step();
          }
        }

        const started = Date.now();
        await waitForConvergence(people, 40_000);
        console.log(
          `TC-12: ${operations * people.length} operations from ${people.length} people ` +
            `converged in ${Date.now() - started}ms`,
        );

        // One board, seen from everywhere.
        const views = people.map((person) => JSON.stringify(person.snapshot()));
        expect(new Set(views).size).toBe(1);

        // Every note a person created is on every board - unless that person deleted it.
        for (const script of scripts) {
          expect(script.created.length).toBeGreaterThan(0);
          for (const id of script.created) {
            const kept = !script.deleted.includes(id);
            for (const view of views) {
              expect(view.includes(`"${id}"`)).toBe(kept);
            }
          }
        }
      } finally {
        board.close();
      }
    },
    120_000,
  );
});

describe('TC-14 a person who joins late gets the board as it is', () => {
  it('hands the whole board to the latecomer in its initial sync', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      for (let index = 0; index < 10; index += 1) {
        createSticky(alex.doc, { x: index * 40, y: 0 });
        createSticky(sam.doc, { x: index * 40, y: 80 });
      }
      await waitForConvergence([alex, sam]);
      expect(alex.snapshot()).toHaveLength(20);

      const carol = await board.join();
      await waitForConvergence([alex, sam, carol]);
      expect(carol.snapshot()).toHaveLength(20);
      expect(carol.snapshot()).toEqual(alex.snapshot());
    } finally {
      board.close();
    }
  });
});

describe('TC-15 malformed traffic is refused without hurting the board', () => {
  const garbage: Record<string, () => Uint8Array | string> = {
    'a text frame': () => 'the room does not speak text',
    'a sync frame with nothing in it': () => new Uint8Array([MESSAGE_SYNC]),
    'an unknown message type': () => new Uint8Array([9, 1, 2, 3]),
    'an update yjs cannot read': () =>
      encodeFrame(
        MESSAGE_SYNC,
        encodeSync((encoder) => {
          syncProtocol.writeUpdate(encoder, new Uint8Array([9, 9, 9, 9, 9]));
        }),
      ),
  };

  it.each(Object.entries(garbage))('%s', async (_name, makeGarbage) => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      createSticky(alex.doc, { x: 0, y: 0 });
      await waitForConvergence([alex, sam]);
      const before = alex.snapshot();
      expect(before).toHaveLength(1);

      alex.sendBytes(makeGarbage());

      const closed = await alex.waitForClose();
      expect(closed.code).toBe(CLOSE_UNSUPPORTED_DATA);

      // The board did not change: someone opening it now sees the one note, and nothing else.
      const witness = await board.join();
      await waitForConvergence([sam, witness]);
      expect(witness.snapshot()).toEqual(before);

      // Sam was not disturbed: still in the room, still receiving edits.
      expect(sam.log.closed).toBe(false);
      createSticky(witness.doc, { x: 100, y: 0 });
      await waitForConvergence([sam, witness]);
      expect(sam.snapshot()).toHaveLength(2);
    } finally {
      board.close();
    }
  });
});

describe('TC-16 awareness reaches everyone in the room', () => {
  it('relays the bytes unchanged to the sender and to the other people', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);

      const awareness = new Awareness(new Y.Doc());
      awareness.setLocalStateField('user', 'Alex');
      const payload = encodeAwarenessUpdate(awareness, [awareness.clientID]);

      alex.sendAwareness(payload);

      await alex.waitFor(() => alex.awarenessFrames().length === 1, 'awareness back');
      await sam.waitFor(() => sam.awarenessFrames().length === 1, 'awareness relayed');

      expect(payloadBytes(alex.awarenessFrames()[0])).toEqual(Array.from(payload));
      expect(payloadBytes(sam.awarenessFrames()[0])).toEqual(payloadBytes(alex.awarenessFrames()[0]));
    } finally {
      board.close();
    }
  });
});

describe('TC-18 the room restarts and the people put the board back', () => {
  it('learns the board again from the first person who reconnects', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);
      for (let index = 0; index < 3; index += 1) {
        createSticky(alex.doc, { x: index * 40, y: 0 });
      }
      createSticky(sam.doc, { x: 0, y: 80 });
      createSticky(sam.doc, { x: 80, y: 80 });
      await waitForConvergence([alex, sam]);
      const before = alex.snapshot();
      expect(before).toHaveLength(5);

      // The room goes away: every socket is closed and the board id now lives in a fresh
      // instance of the object.
      board.restart();
      const witness = await board.joinRestartedRoom();
      expect(witness.snapshot()).toEqual([]);

      // Alex reconnects first: the room has nothing, so Alex's document becomes the board.
      await board.reconnectToRestartedRoom(alex);
      await waitForConvergence([alex, witness]);
      expect(witness.snapshot()).toEqual(before);

      // Sam reconnects second and converges with what Alex carried.
      await board.reconnectToRestartedRoom(sam);
      await waitForConvergence([alex, sam, witness]);
      expect(sam.snapshot()).toEqual(before);
      expect(alex.snapshot()).toEqual(before);
    } finally {
      board.close();
    }
  });
});

describe('TC-31 a socket that died does not take the room with it', () => {
  it('drops the dead socket and keeps relaying to everyone else', async () => {
    const board = new Board();
    try {
      const [alex, sam] = await Promise.all([board.join(), board.join()]);
      await waitForConvergence([alex, sam]);

      // Sam's socket goes away; the room only notices when it next tries to send.
      sam.close();
      createSticky(alex.doc, { x: 0, y: 0 });

      // The room survived: Alex is still in it, and a new person still gets the board.
      expect(alex.log.closed).toBe(false);
      const carol = await board.join();
      await waitForConvergence([alex, carol]);
      expect(carol.snapshot()).toHaveLength(1);

      // And the room still relays both ways afterwards.
      createSticky(carol.doc, { x: 40, y: 0 });
      await waitForConvergence([alex, carol]);
      expect(alex.snapshot()).toHaveLength(2);
    } finally {
      board.close();
    }
  });
});

describe('story 5: a room with no board behind it (TC-10, TC-11)', () => {
  it('serves a board that was made, and nobody else (TC-10)', async () => {
    const id = boardId();
    const made = await makeBoard(id);
    expect(made).toBe('created');

    const response = await boardStub(id).fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    expect(response.status).toBe(101);
    hangUp(response);

    // The board next door, which nobody made, is not served by the same room's success.
    const stranger = await boardStub(boardId()).fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    expect(stranger.status).toBe(404);
    hangUp(stranger);
  });

  it('refuses an upgrade to a link that was never a board, and writes nothing (TC-11, negative)', async () => {
    const id = boardId();
    const response = await boardStub(id).fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    // 404, and not a WebSocket: the answer a mistyped link gets, before anything is accepted,
    // relayed or stored. The client turns this into "Board not found" without any code of its own
    // about why.
    expect(response.status).toBe(404);
    expect(response.webSocket ?? null).toBeNull();

    // Asking for a board is not what makes one: the address is as empty as it was, so the next
    // person to mistype it gets the same answer for the same reason.
    expect(await tablesIn(id)).toEqual([]);

    // And the room still says no when asked again, in the same instance that said it the first
    // time - it is not a question that answers itself by being asked.
    const again = await boardStub(id).fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    expect(again.status).toBe(404);
    expect(await tablesIn(id)).toEqual([]);
  });

  it('lets a board made the old way in, on the strength of its log (share.legacy_boards)', async () => {
    const id = boardId();
    await insideBoard(boardStub(id), (store) => {
      store.append(updateOfNote('The board stays where we left it'));
      return true;
    });
    const response = await boardStub(id).fetch(
      new Request('http://board-room/', { headers: { Upgrade: 'websocket' } }),
    );
    expect(response.status).toBe(101);
    hangUp(response);
  });
});
