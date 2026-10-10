/**
 * TC-29 and TC-30 (story 3: live.stability) — the two tests that hold a board
 * open for minutes, tagged `@nightly` so only `npm run test:e2e:nightly` runs
 * them. The board id is random, and the room is a Durable Object that has never
 * seen this board before: the whole point is what a board does over time, so
 * nothing here may inherit state from an earlier run.
 *
 * The waiting is real. What the PRD scales down is idle time only (90 idle
 * minutes at a second per minute), never an outage and never the soak.
 */
import { expect, test } from '@playwright/test';

import { createBoard } from './helpers/share';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  NIGHTLY_EDIT_SPACING_MS,
  NIGHTLY_IDLE_WATCH_MS,
  NIGHTLY_SOAK_MINUTES,
} from '../../src/shared/config';
import {
  centreOf,
  connectionStates,
  createNote,
  dragNoteTo,
  everyPageSees,
  EMPTY_CORNER,
  expectEveryPageSees,
  notesOf,
  openBoard,
  slot,
  watchConnection,
  type Participant,
} from './helpers/live';
import { camera } from './helpers/board';

/** The states that mean "this board is losing, or has lost, the room". */
const OUT_OF_THE_ROOM = ['connecting', 'reconnecting'];

/** A board nobody touches: does it stay exactly as it was? */
test('TC-29 @nightly a board nobody touches stays put through 90 idle minutes', async ({
  browser,
  request,
}) => {
  // The watch itself, plus opening two boards and settling them twice.
  test.setTimeout(NIGHTLY_IDLE_WATCH_MS + 180_000);

  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');
  const pages = [alex.page, sam.page];

  await createNote(alex.page, slot(2, 2));
  await createNote(sam.page, slot(3, 2));
  await expectEveryPageSees(pages, 2, 'two notes on two screens');
  const untouched = await notesOf(alex.page);

  // The badge is out of the way when everything is normal, so what is watched is
  // the state the badge is built from.
  await Promise.all(pages.map(watchConnection));
  const watchedAt = Date.now();
  await alex.page.waitForTimeout(NIGHTLY_IDLE_WATCH_MS);
  await sam.page.waitForTimeout(Math.max(0, NIGHTLY_IDLE_WATCH_MS - (Date.now() - watchedAt)));

  for (const person of [alex, sam]) {
    const states = await connectionStates(person.page);
    const churn = states.filter((state) => OUT_OF_THE_ROOM.includes(state));
    expect(
      churn,
      `${person.name} reconnected while nobody was doing anything (states seen: ${states.join(', ')})`,
    ).toEqual([]);
    expect(
      person.problems.filter((problem) => !/websocket/i.test(problem)),
      `${person.name} produced console noise while idle`,
    ).toEqual([]);
  }

  // Nothing moved, nothing duplicated, nothing faded: the same board, still.
  expect(await everyPageSees(pages, 2), 'the board changed while nobody was in it').toBe('identical');
  expect(await notesOf(sam.page)).toEqual(untouched);
  console.log(
    `[e2e] ${Math.round(NIGHTLY_IDLE_WATCH_MS / 60_000)} idle minutes: states seen ${JSON.stringify(
      await connectionStates(alex.page),
    )} (TC-29)`,
  );

  await Promise.all([alex.context.close(), sam.context.close()]);
});

/**
 * The soak: five people, five minutes, one edit each every five seconds. The
 * time each round takes to settle is written down; the last round also has to
 * agree everywhere, and it has to agree exactly.
 */
test(`TC-30 @nightly ${MAX_CONCURRENT_EDITORS} people edit the same board for ${NIGHTLY_SOAK_MINUTES} minutes and end up with the same board`, async ({
  browser,
  request,
}) => {
  const soakMs = NIGHTLY_SOAK_MINUTES * 60 * 1000;
  test.setTimeout(soakMs + 240_000);

  const boardId = await createBoard(request);
  const people: Participant[] = [];
  for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
    people.push(await openBoard(browser, boardId, `person ${index + 1}`));
  }
  const pages = people.map((person) => person.page);

  // One note each, in a column of their own.
  const ids: string[] = [];
  for (const [index, person] of people.entries()) {
    ids.push(await createNote(person.page, slot(index, 0)));
  }
  await expectEveryPageSees(pages, ids.length, 'everyone got one note of their own');
  await Promise.all(pages.map(watchConnection));

  const rounds = Math.round(soakMs / NIGHTLY_EDIT_SPACING_MS);
  const rows = 4;
  let lastCatchUpMs = 0;
  let slowestRoundMs = 0;
  const startedAt = Date.now();
  /*
   * Where each person's note is supposed to stand after the round just run.
   *
   * Built from measured numbers rather than from the slot the drag was aimed at,
   * because the two frames are not the same frame: the screen point a drag ends
   * at, and the board coordinate the note is stored at, differ by whatever the
   * view happens to be doing. Measured — the app's own initial camera lands a
   * beat after the board mounts and puts the world origin at the centre of the
   * viewport (a pan of 640,400 in this viewport; `zoomOutTo` in
   * `helpers/live.ts` waits for exactly this), so a test that reads a note's
   * stored coordinates as screen pixels is really asserting "the view never
   * moved". That is not what this soak is for. So: where the note was, plus how
   * far the pointer travelled, divided by the zoom it travelled at — the drag
   * itself, stated in the board's own coordinates, whatever the view does.
   */
  const standing = new Map<string, { x: number; y: number }>();

  for (let round = 0; round < rounds; round += 1) {
    const roundAt = Date.now();
    // One drag each: their own note, to a place of their own in their column.
    await Promise.all(
      people.map(async (person, index) => {
        const to = slot(index, (round + index) % rows);
        const noteId = ids[index] as string;
        const [where] = (await notesOf(person.page)).filter((note) => note.id === noteId);
        const from = await centreOf(person.page, noteId);
        const { zoom } = await camera(person.page);
        if (!where) throw new Error(`person ${index + 1} has no note ${noteId} to move`);
        standing.set(noteId, {
          x: where.x + (to.x - from.x) / zoom,
          y: where.y + (to.y - from.y) / zoom,
        });
        await dragNoteTo(person.page, noteId, to);
        // Deselect again: the toolbar of a selected note floats beside it, and
        // the next round's drag must not start on somebody else's toolbar.
        await person.page.mouse.click(EMPTY_CORNER.x, EMPTY_CORNER.y);
      }),
    );

    await expect
      .poll(() => everyPageSees(pages, ids.length), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `round ${round}: the five screens never agreed on where the notes stand`,
      })
      .toBe('identical');
    lastCatchUpMs = Date.now() - roundAt;
    slowestRoundMs = Math.max(slowestRoundMs, lastCatchUpMs);
    if (round % 10 === 0) {
      console.log(`[e2e] soak round ${round}/${rounds}: settled in ${lastCatchUpMs}ms`);
    }

    // The pace the PRD names, not a pace this machine can go faster than.
    const spent = Date.now() - roundAt;
    const pad = Math.max(0, NIGHTLY_EDIT_SPACING_MS - spent);
    await Promise.all(pages.map((page) => page.waitForTimeout(pad)));
  }

  // Five minutes of that: still exactly one note each, all five screens the
  // same, and every note where the person who moves it last put it.
  expect(await everyPageSees(pages, ids.length), 'the soak ended with a board in disagreement').toBe(
    'identical',
  );
  const finalViews = await Promise.all(pages.map(notesOf));
  const misplaced: string[] = [];
  for (const [index, view] of finalViews.entries()) {
    expect(
      [...view.map((note) => note.id)].sort(),
      `person ${index + 1} holds a different set of notes after the soak`,
    ).toEqual([...ids].sort());
    for (const note of view) {
      const where = standing.get(note.id);
      if (!where) throw new Error(`note ${note.id} has no place it was moved to`);
      if (Math.abs(note.x - where.x) > 2 || Math.abs(note.y - where.y) > 2) {
        misplaced.push(
          `person ${index + 1} shows note ${note.id} at (${note.x}, ${note.y}), not at (${where.x}, ${where.y})`,
        );
      }
    }
  }
  expect(misplaced, 'every note stands where the person who moves it last put it').toEqual([]);

  for (const person of people) {
    const states = await connectionStates(person.page);
    expect(
      states.filter((state) => OUT_OF_THE_ROOM.includes(state)),
      `${person.name} lost the room during the soak (states seen: ${states.join(', ')})`,
    ).toEqual([]);
    expect(
      person.problems.filter((problem) => !/websocket/i.test(problem)),
      `${person.name} produced console noise during the soak`,
    ).toEqual([]);
  }

  const edits = rounds * people.length;
  console.log(
    `[e2e] soak: ${people.length} people x ${rounds} rounds = ${edits} changes in ${Math.round(
      (Date.now() - startedAt) / 1000,
    )}s; last catch-up ${lastCatchUpMs}ms, slowest round ${slowestRoundMs}ms (TC-30, not asserted)`,
  );

  await Promise.all(people.map((person) => person.context.close()));
});
