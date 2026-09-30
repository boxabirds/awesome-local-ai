// Story 4, told the way it actually happens: a server that is stopped, started
// again, and killed outright, with a board in it, and a browser that comes back to
// find everything where it left it.
//
// These specs run their own `wrangler dev` with `--persist-to`, because the suite's
// shared server is in-memory and belongs to the run. Everything else is the same
// machinery the story 1-3 specs use: real Chromium, real WebSockets, real Yjs, and
// two people who share nothing but the room.
//
// Specs: spec/stories/004-return-to-a-board-and-find-everything-as-it-was-le/
// design.md, sections persist.restart and persist.e2e_hooks (TC-19 to TC-21, TC-24).
import { test, expect } from '@playwright/test';
import { PersistentServer } from './helpers/persistent-server';
import {
  createNote,
  expectEventually,
  openParticipantAt,
  outageNoise,
  stopEditing,
  type,
  type Participant,
} from './helpers/participants';
import { settle } from './helpers/board';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_FAILED_TEXT } from '../../src/client/sync/ConnectionStatus';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

/**
 * A server of the scenario's own, over a directory of its own, started, used, and
 * given back. It cannot be one server for the file: Playwright runs these in
 * parallel with everything else, and a server that one scenario restarts while
 * another is writing to it is a race rather than a test.
 */
async function withServer(
  run: (server: PersistentServer) => Promise<void>,
): Promise<void> {
  const server = await PersistentServer.create({ testHooks: true });
  try {
    await server.start();
    await run(server);
  } finally {
    await server.cleanup();
  }
}

/** Ask the test hook to do something to a board. */
async function hook(
  server: PersistentServer,
  boardId: string,
  kind: 'compact' | 'corrupt-snapshot' | 'repair-snapshot',
): Promise<unknown> {
  const response = await fetch(`${server.origin}/api/rooms/${boardId}?__test=${kind}`, {
    method: 'POST',
  });
  return response.status === 404 ? { absent: response.status } : await response.json();
}

/**
 * Put `count` notes with text on a board, and hand back their ids in order. The
 * grid is 140 by 170 screen pixels because a note is 1200 hundredths of a unit —
 * 120 world units, 120 pixels at the board's starting zoom — and a double-click
 * that lands on a note that is already there edits that note instead of making a
 * new one, which is precisely the thing not to do by accident.
 */
async function fill(who: Participant, count: number, text: (index: number) => string): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = 140 + (index % 8) * 140;
    const y = 100 + Math.floor(index / 8) * 170;
    const id = await createNote(who, x, y, text(index));
    await stopEditing(who);
    ids.push(id);
  }
  await settle(who.page);
  return ids;
}

test('a board is there again after the server has been restarted (TC-19)', async ({ browser }) => {
  await withServer(async (server) => {
    const boardId = newBoardId();
    await server.seedBoard(boardId);
    const alex = await openParticipantAt(browser, server.boardUrl(boardId), 'Alex');
    const ids = await fill(alex, 3, (index) => `note ${String(index + 1)}`);
    const expected = await alex.snapshot();

    // Everybody leaves, and the server goes with them.
    await alex.close();
    await server.restart();

    // A person who has never seen this board, arriving at its address after the
    // server came back: this is the story.
    const sam = await openParticipantAt(browser, server.boardUrl(boardId), 'Sam');
    expect(await sam.snapshot()).toBe(expected);
    const first = await sam.note(ids[0]!);
    expect(first?.text).toBe('note 1');
    expect(first?.editing).toBe(false);

    // And it is a board again, not a photograph of one: a note made now reaches
    // another screen through the room that was rebuilt out of storage.
    const shared = await createNote(sam, 900, 700, 'after the restart');
    await stopEditing(sam);
    const taylor = await openParticipantAt(browser, server.boardUrl(boardId), 'Taylor');
    await expectEventually('the third person sees the note made after the restart', () => taylor.note(shared), {
      is: (note) => note?.text === 'after the restart',
    });

    await taylor.close();
    await sam.close();
  });
});

test('a board is not half-written when the process is killed outright (TC-20)', async ({
  browser,
}) => {
  await withServer(async (server) => {
    const boardId = newBoardId();
    await server.seedBoard(boardId);
    const alex = await openParticipantAt(browser, server.boardUrl(boardId), 'Alex');
    const ids = await fill(alex, 5, (index) => `line ${String(index + 1)}`);
    const saved = await alex.notes();

    // Alex is in the middle of typing in a sixth note when the process is killed
    // with no chance to clean anything up.
    const sixth = await createNote(alex, 1000, 700, '');
    await type(alex, ' typed while the server died');
    await server.stop('hard');

    // Nothing was said to Alex's browser: it still shows the board it had, editor
    // open. What it cannot know yet is that nothing behind it is listening.
    expect((await alex.note(sixth))?.editing).toBe(true);

    await server.start();

    // A second person arrives. The board is a whole board: every note that was on
    // it before the kill is there, with its text and its place.
    const sam = await openParticipantAt(browser, server.boardUrl(boardId), 'Sam');
    const seen = await sam.notes();
    for (const id of ids) {
      const before = saved.get(id);
      const after = seen.get(id);
      expect(after, `note ${id} survived the kill`).toBeDefined();
      expect(after?.text).toBe(before?.text);
      expect(after?.left).toBe(before?.left);
      expect(after?.top).toBe(before?.top);
    }

    // The strongest thing that can be said about it: Alex's own screen reconnects,
    // the two of them exchange what they have, and they end on one board. A file
    // that had been written half way through would not allow that.
    await expectEventually(
      "Alex's screen rejoins the room",
      () => alex.connectionState(),
      { is: (state) => state === 'connected' },
      { interval: 250 },
    );
    await expectEventually(
      'both screens agree on the board',
      async () => [await alex.snapshot(), await sam.snapshot()] as const,
      { is: ([one, two]) => one === two },
      { interval: 250 },
    );

    // And the sixth note, the one being typed when the server died, is on the
    // board now: the change was never lost, only unwritten, and the person who
    // made it hands it over when they come back.
    await expectEventually('the note that was being typed is on the board', () => sam.note(sixth), {
      is: (note) => note?.text.includes('typed while the server died') === true,
    });

    await alex.close();
    await sam.close();
  });
});

test('a board that sat untouched comes back with all of it (TC-21)', async ({ browser }) => {
  // The idle itself is a nightly scenario (nightly/idle-and-soak.spec.ts); what is
  // checked here is that a board left alone is the board that comes back.
  await withServer(async (server) => {
    const boardId = newBoardId();
    await server.seedBoard(boardId);
    const alex = await openParticipantAt(browser, server.boardUrl(boardId), 'Alex');
    const ids = await fill(alex, 25, (index) => `idle note ${String(index + 1)}`);
    const expected = await alex.snapshot();
    await alex.close();

    await server.restart();

    const sam = await openParticipantAt(browser, server.boardUrl(boardId), 'Sam');
    expect(await sam.snapshot()).toBe(expected);
    const seen = await sam.notes();
    expect(seen.size).toBe(25);
    for (const [index, id] of ids.entries()) {
      expect(seen.get(id)?.text).toBe(`idle note ${String(index + 1)}`);
    }

    await sam.close();
  });
});

// The damage and the repair are done through the hooks the server was started
// with, over HTTP, in front of a browser that is watching — the e2e half of task
// 4. A board is only worth calling damaged once somebody can see what is said
// about it.
test('a board that cannot be read says so, and the reading of it comes back (TC-24)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await withServer(async (server) => {
    const boardId = newBoardId();
    await server.seedBoard(boardId);
    const alex = await openParticipantAt(browser, server.boardUrl(boardId), 'Alex');
    await fill(alex, 25, (index) => `snapshot note ${String(index + 1)}`);
    const expected = await alex.snapshot();

    // The board is put into the state a damaged snapshot puts it in, compacted
    // first so that what gets damaged is the snapshot rather than a log row.
    expect(await hook(server, boardId, 'compact')).toEqual({ ok: true });
    expect(await hook(server, boardId, 'corrupt-snapshot')).toEqual({ ok: true });

    // Whoever is already looking is told, and whoever arrives is told: the same
    // message, on a board that is still on the screen.
    await expectEventually('Alex is told the board could not be loaded', () => alex.badgeText(), {
      is: (text) => text === LOAD_FAILED_TEXT,
    });
    const sam = await openParticipantAt(browser, server.boardUrl(boardId), 'Sam', {
      waitUntil: 'loaded',
    });
    await expectEventually('Sam is told the board could not be loaded', () => sam.badgeText(), {
      is: (text) => text === LOAD_FAILED_TEXT,
    });
    expect(await sam.badgeState()).toBe('load_failed');

    // The board was not written over in the meantime: the repair finds the same
    // board that was there.
    expect(await hook(server, boardId, 'repair-snapshot')).toEqual({ ok: true });

    // And Sam gets it without touching the browser. The retry is the room's, at
    // most once per LOAD_RETRY_MIN_INTERVAL_MS, so this waits out an interval.
    await expectEventually(
      `Sam sees the board again within the retry interval (${String(LOAD_RETRY_MIN_INTERVAL_MS)}ms) plus backoff`,
      () => sam.snapshot(),
      { is: (value) => value === expected },
      { interval: 500 },
    );
    expect(await sam.badgeText()).toBeNull();

    // The board works again for both of them.
    const shared = await createNote(sam, 1100, 740, 'after the repair');
    await stopEditing(sam);
    await expectEventually('Alex sees the note made after the repair', () => alex.note(shared), {
      is: (note) => note?.text === 'after the repair',
    });

    const errors = [...alex.consoleErrors, ...sam.consoleErrors].filter((line) => !outageNoise(line));
    expect(errors).toEqual([]);

    await alex.close();
    await sam.close();
  });
});
