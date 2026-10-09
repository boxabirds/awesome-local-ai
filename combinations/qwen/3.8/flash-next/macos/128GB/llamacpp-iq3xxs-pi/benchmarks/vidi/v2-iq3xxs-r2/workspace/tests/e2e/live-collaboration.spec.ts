import { expect, test, type Browser } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';
import {
  applyChange,
  boardLink,
  boardMarkers,
  capacity,
  createBoard,
  createBoardLink,
  closeParticipants,
  connectionState,
  createNoteAt,
  createParticipants,
  deleteNote,
  endEditing,
  expectBadgeHidden,
  expectConverged,
  expectEventually,
  expectNoErrors,
  logLatency,
  logLatencySummary,
  markerPosition,
  moveNoteBy,
  notesOf,
  OUTAGE_DETECTION_TIMEOUT_MS,
  positionOf,
  recolourNote,
  RECOVERY_TIMEOUT_MS,
  setOffline,
  snapshotOf,
  startTyping,
  textOf,
  typeInto,
  waitForBadge,
  type LatencySample,
  type Participant,
  type Point,
} from './helpers/participants';

/**
 * Story 3: two or more people on one board. Everything here goes through the real UI in
 * real browsers against the real room, and nothing waits a fixed amount of time in place
 * of an outcome — a change is waited for, and how long it took is logged against
 * `LIVE_UPDATE_LATENCY_BUDGET_MS` without the budget ever being asserted.
 */

const SPOT = { x: 400, y: 220 };
const OTHER_SPOT = { x: 800, y: 480 };

/**
 * Two people on a board neither has been on before, connected enough that the first
 * change already reached the other browser.
 */
async function twoPeople(browser: Browser): Promise<{
  boardId: string;
  note: string;
  alex: Participant;
  sam: Participant;
  people: Participant[];
}> {
  // A board these two can join has to have been made by the service first (story 5).
  const boardId = await createBoard(browser);
  const people = await createParticipants(browser, boardLink(boardId), 2);
  const [alex, sam] = people as [Participant, Participant];
  let note = '';
  await applyChange(
    'opening note',
    alex,
    async () => {
      note = await createNoteAt(alex, SPOT);
      await endEditing(alex);
    },
    [sam],
  );
  return { boardId, note, alex, sam, people };
}

async function createNoteAtWith(person: Participant, at: Point): Promise<void> {
  await createNoteAt(person, at);
  await endEditing(person);
}

/** Sorted characters, so two texts can be compared without caring about order. */
function letters(text: string): string {
  return [...text].sort().join('');
}

test('TC-22: every change one person makes appears for the other', async ({ browser }) => {
  const { note, alex, sam, people } = await twoPeople(browser);
  const samples: LatencySample[] = [];
  try {
    samples.push(
      ...(await applyChange('create', alex, () => createNoteAtWith(alex, OTHER_SPOT), [sam])),
    );

    samples.push(
      ...(await applyChange('move', alex, () => moveNoteBy(alex, note, { x: 180, y: 120 }), [
        sam,
      ])),
    );
    // The marker moved on Sam's screen, not just in Sam's document, and both screens show
    // the same thing.
    const samMarker = await markerPosition(sam.page, note);
    const alexMarker = await markerPosition(alex.page, note);
    expect(samMarker).toEqual(alexMarker);
    expect(samMarker.x).toBeGreaterThan(SPOT.x + 100);
    expect(samMarker.y).toBeGreaterThan(SPOT.y + 60);

    samples.push(
      ...(await applyChange('type', alex, () => typeInto(alex, note, 'ship on Thursday'), [sam])),
    );
    expect(await textOf(sam, note)).toContain('ship on Thursday');

    samples.push(
      ...(await applyChange('recolour', alex, () => recolourNote(alex, note, 'violet'), [sam])),
    );
    expect((await notesOf(sam)).find((candidate) => candidate.id === note)?.color).toBe('violet');

    samples.push(...(await applyChange('delete', alex, () => deleteNote(alex, note), [sam])));
    expect(await notesOf(sam)).toHaveLength(1);

    // The two boards are the same board, right down to where each note is painted.
    const converged = await expectConverged(people);
    expect(await snapshotOf(alex.page)).toBe(converged);
    expect(await snapshotOf(sam.page)).toBe(converged);
    expect(await boardMarkers(alex.page)).toEqual(await boardMarkers(sam.page));
    logLatencySummary(samples);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-23: both type into the same note at the same time and agree on what it says', async ({
  browser,
}) => {
  const { note, alex, sam, people } = await twoPeople(browser);
  try {
    const typed: [string, string] = ['alex: bring your own diagram', 'sam: and a second monitor'];
    await startTyping(alex, note);
    await startTyping(sam, note);
    await Promise.all([alex.page.keyboard.type(typed[0]), sam.page.keyboard.type(typed[1])]);
    await endEditing(alex);
    await endEditing(sam);
    await expectConverged(people);

    // Nothing was lost and nothing was duplicated: the sorted characters of the merged
    // text are exactly the sorted characters of what the two of them typed.
    const alexText = await textOf(alex, note);
    const samText = await textOf(sam, note);
    expect(alexText).toBe(samText);
    expect(letters(alexText)).toBe(letters(typed.join('')));
    expect(letters(samText)).toBe(letters(typed.join('')));
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-24: both drag the same note at the same time and it ends in one place', async ({
  browser,
}) => {
  const { note, alex, sam, people } = await twoPeople(browser);
  try {
    const settled = Date.now();
    await Promise.all([
      moveNoteBy(alex, note, { x: -140, y: -90 }),
      moveNoteBy(sam, note, { x: 160, y: 110 }),
    ]);
    await expectConverged(people);
    const alexPosition = await positionOf(alex, note);
    const samPosition = await positionOf(sam, note);
    expect(alexPosition).toEqual(samPosition);
    // The note is somewhere else, so the drag really happened and really merged.
    const movedBy =
      Math.abs(alexPosition.x - SPOT.x) + Math.abs(alexPosition.y - SPOT.y);
    expect(movedBy).toBeGreaterThan(1);
    expect(await boardMarkers(alex.page)).toEqual(await boardMarkers(sam.page));
    console.log(
      `[latency] two people dragging one note settled in ${Date.now() - settled}ms (budget ${
        2000
      }ms, reported not asserted)`,
    );
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-25: a note deleted while someone is typing inside it stays deleted', async ({
  browser,
}) => {
  const { note, alex, sam, people } = await twoPeople(browser);
  try {
    await startTyping(sam, note);
    await sam.page.keyboard.type('while alex was deciding');
    await deleteNote(alex, note);

    await expectEventually(
      sam.page,
      'the note is gone for Sam',
      async () => (await notesOf(sam)).length === 0,
    );
    await expect(sam.page.locator(`[data-note-id="${note}"]`)).toHaveCount(0);
    // The editor Sam was typing into closed with the note.
    await expect(sam.page.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
    // And Sam carries on working, and Alex sees that too.
    await createNoteAtWith(sam, OTHER_SPOT);
    await expectEventually(
      alex.page,
      'Sam keeps working after the note vanished under them',
      async () => (await notesOf(alex)).length === 1,
    );
    await expectConverged(people);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-26: a full room of editors all sees everything the others do', async ({ browser }) => {
  test.setTimeout(240_000);
  const seats = capacity();
  const people = await createParticipants(browser, await createBoardLink(browser), seats);
  try {
    // Each seat owns a column of the board, so a note is never in two places at once.
    const spotFor = (seat: number, index: number): Point => ({
      x: 260 + seat * Math.floor(800 / seats),
      y: 150 + index * 100,
    });
    const notesExpected = seats * 5;

    const created = await Promise.all(
      people.map(async (person, seat) => {
        const ids: string[] = [];
        for (let index = 0; index < 5; index += 1) {
          ids.push(await createNoteAt(person, spotFor(seat, index)));
          await endEditing(person);
        }
        return ids;
      }),
    );
    for (const person of people) {
      await expectEventually(
        person.page,
        `${person.name} sees every note in the room`,
        async () => (await notesOf(person)).length === notesExpected,
      );
    }
    await expectConverged(people);

    await Promise.all(
      people.map(async (person, seat) => {
        for (const [index, id] of created[seat]!.entries()) {
          await moveNoteBy(person, id, { x: 40 + index * 6, y: -30 - seat * 8 });
        }
      }),
    );

    // Every change landed for everybody, and the room agrees on the board.
    const converged = await expectConverged(people);
    const snapshots = await Promise.all(people.map((person) => snapshotOf(person.page)));
    expect(new Set(snapshots).size).toBe(1);
    expect(snapshots[0]).toBe(converged);
    for (const person of people) {
      expect(await boardMarkers(person.page)).toEqual(await boardMarkers(people[0]!.page));
    }
    for (const ids of created) expect(ids).toHaveLength(5);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-27: one person drops out, the board keeps working, and they catch up', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { alex, sam, people } = await twoPeople(browser);
  try {
    await expectBadgeHidden(alex.page);
    expect(await connectionState(alex.page)).toBe('connected');

    const offAt = Date.now();
    await setOffline(alex, true);
    // Sam is unaffected by the outage and keeps working.
    const madeLater = await createNoteAt(sam, OTHER_SPOT);
    await endEditing(sam);
    await expectEventually(
      sam.page,
      'Sam keeps making notes while Alex is out',
      async () => (await notesOf(sam)).some((note) => note.id === madeLater),
    );
    await expectBadgeHidden(sam.page);

    // Alex's browser knows the connection has gone and says so — nothing it does locally
    // depends on the network, so it takes `y-websocket`'s own silence timeout to notice —
    // and it keeps trying by itself.
    await waitForBadge(alex.page, 'Reconnecting…', OUTAGE_DETECTION_TIMEOUT_MS);
    // The interruption lasts the outage budget it is specified to last.
    const stillOut = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - offAt);
    if (stillOut > 0) await new Promise((resolve) => setTimeout(resolve, stillOut));
    await setOffline(alex, false);

    // Alex comes back with no further action: the client reconnected on its own and the
    // note Sam made during the outage arrived. Measured from going back online and
    // reported against the length of the outage, not the budget for a live connection.
    const backOnline = Date.now();
    await expectEventually(
      alex.page,
      'the notes Alex missed while offline arrive',
      async () => (await notesOf(alex)).some((note) => note.id === madeLater),
      RECOVERY_TIMEOUT_MS,
    );
    logLatency({
      op: 'catch-up after outage → Alex',
      latencyMs: Date.now() - backOnline,
      budgetMs: CATCH_UP_TEST_OUTAGE_MS,
    });
    await expectEventually(
      alex.page,
      'Alex stops reporting a problem',
      async () => (await connectionState(alex.page)) === 'connected',
    );
    await expectConverged(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-28: two boards in the same browser never mix', async ({ browser }) => {
  const firstBoard = await createBoard(browser);
  const secondBoard = await createBoard(browser);
  const first = await createParticipants(browser, boardLink(firstBoard), 2);
  const second = await createParticipants(browser, boardLink(secondBoard), 2);
  const people = [...first, ...second];
  try {
    // Every browser is connected to its own board, by address.
    for (const person of people) {
      const own = first.includes(person) ? firstBoard : secondBoard;
      const other = first.includes(person) ? secondBoard : firstBoard;
      expect(
        person.sockets.some((url) => url.includes(own)),
        `${person.name} connects to ${own}`,
      ).toBe(true);
      expect(
        person.sockets.some((url) => url.includes(other)),
        `${person.name} never connects to ${other}`,
      ).toBe(false);
    }

    await createNoteAtWith(first[0]!, SPOT);
    await expectEventually(
      first[1]!.page,
      'the note appears on the other browser on the same board',
      async () => (await notesOf(first[1]!)).length === 1,
    );
    // The other board has nothing of it.
    expect(await notesOf(second[0]!)).toHaveLength(0);
    expect(await notesOf(second[1]!)).toHaveLength(0);

    const note = (await notesOf(first[0]!))[0]!.id;
    await applyChange(
      'move on one board',
      first[0]!,
      () => moveNoteBy(first[0]!, note, { x: 120, y: 90 }),
      [first[1]!],
    );
    expect(await boardMarkers(second[0]!.page)).toEqual([]);
    expect(await boardMarkers(second[1]!.page)).toEqual([]);
    await expectConverged(first);
    await expectConverged(second);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});
