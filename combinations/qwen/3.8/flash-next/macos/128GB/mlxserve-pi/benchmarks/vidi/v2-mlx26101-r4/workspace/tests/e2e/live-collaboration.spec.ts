/**
 * Story 3, in real browsers: other people's edits appear live on the same board.
 *
 * Every test here opens at least two isolated browser contexts on one board address and
 * checks that what one of them does shows up on the other. The server is the real one
 * (`wrangler dev`: the Worker and its board room), the protocol is the real one
 * (y-protocols over a WebSocket), and nothing is stubbed. The only thing a test supplies
 * is a second pair of hands.
 *
 * About timing: the moment a change is made and the moment it appears are what this
 * feature is for, so each of those waits is measured and printed against
 * LIVE_UPDATE_LATENCY_BUDGET_MS (see `expectEventually`). Going over that budget is not
 * a failure: the browser, the model and the board room all run on this one machine, so a
 * number says as much about the machine as about the board. What fails a run is the
 * functional outcome — the change arrives, the two boards agree.
 */
import { expect, test } from '@playwright/test';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../src/shared/config';
import { board, DRAG_DOWN, DRAG_RIGHT, settled } from './helpers/board';
import {
  createNote,
  deleteButton,
  editor,
  pasteIntoEditor,
  swatch,
} from './helpers/sticky';
import {
  aimCamera,
  badgeText,
  centreOf,
  closeParticipants,
  connectionState,
  documentOf,
  dragNoteById,
  editNoteById,
  expectConverged,
  expectEventually,
  goOffline,
  isEditingOnPage,
  isSelectedOnPage,
  logLatencies,
  measurements,
  noteCount as pageNoteCount,
  openParticipants,
  paintedIndexOf,
  paintedNotes,
  RECONNECT_WAIT_MS,
  selectNoteById,
  snapshotKey,
  type Participant,
} from './helpers/participants';

/** Where the first note of a test goes; later notes go beside it. */
const NOTE_AT = { x: 420, y: 300 };
/** What two people type into one note, in words that share no letters at all. */
const WORDS = { base: 'leaf', alex: 'rck', sam: 'dst' };
/** A camera that fits a board full of notes on one screen (world units, zoom). */
const WIDE = { x: -640, y: -400, zoom: 0.3 };

let people: Participant[] = [];

test.beforeEach(() => {
  people = [];
});

test.afterEach(async () => {
  await closeParticipants(people);
  people = [];
  // A test that measured something gets a report; the soak prints its own, under its own
  // heading, and there is nothing left to say after that.
  if (measurements().length > 0) logLatencies();
});

// ---------------------------------------------------------------------------
// Reading one person's board
// ---------------------------------------------------------------------------

async function noteById(participant: Participant, id: string) {
  return (await documentOf(participant)).find((note) => note.id === id);
}

function textOf(participant: Participant, id: string): Promise<string | null> {
  return noteById(participant, id).then((note) => note?.text ?? null);
}

function positionOf(participant: Participant, id: string): Promise<{ x: number; y: number } | null> {
  return noteById(participant, id).then((note) => (note ? { x: note.x, y: note.y } : null));
}

function colourOf(participant: Participant, id: string): Promise<string | null> {
  return noteById(participant, id).then((note) => note?.color ?? null);
}

/** How many notes this page paints. */
function painted(participant: Participant): Promise<number> {
  return paintedNotes(participant).count();
}

/** Nothing in anybody's console, which is what "nothing went wrong" means here. */
function expectNoConsoleErrors(...participants: Participant[]): void {
  for (const participant of participants) {
    expect(participant.errors, `${participant.name} logged console errors`).toEqual([]);
  }
}

/** The characters of a string, sorted: the same letters in any order read the same. */
function characters(text: string): string {
  return [...text].sort().join('');
}

// ---------------------------------------------------------------------------
// Workflow: two-person workshop (TC-22 to TC-25, TC-28)
// ---------------------------------------------------------------------------

test.describe('two-person workshop', () => {
  test('TC-22: create, move, recolour, type and delete all appear for the other person', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];

    // --- create ---
    let since = Date.now();
    const id = await createNote(alex.page, NOTE_AT, 'Notes');
    await expectEventually('Sam sees the note Alex made', () => pageNoteCount(sam), {
      since,
    }).toBe(1);
    await expectEventually('Sam sees the text that came with it', () => textOf(sam, id), {
      since,
    }).toBe('Notes');
    expect(await noteById(sam, id), 'the note has the same id on both boards').toBeTruthy();

    // --- move ---
    const before = await positionOf(alex, id);
    since = Date.now();
    await dragNoteById(alex, id, DRAG_RIGHT, DRAG_DOWN);
    await expectEventually('Sam sees the note move', () => positionOf(sam, id), {
      since,
    }).toEqual(await positionOf(alex, id));
    expect(await positionOf(alex, id), 'Alex moved it').not.toEqual(before);

    // --- recolour ---
    since = Date.now();
    await swatch(alex.page, 'blue').click();
    await expectEventually('Sam sees the note turn blue', () => colourOf(sam, id), { since }).toBe(
      'blue',
    );

    // --- type, one keystroke at a time ---
    since = Date.now();
    await editNoteById(alex, id);
    await alex.page.keyboard.type(' of paper');
    await expectEventually('Sam sees every character Alex typed', () => textOf(sam, id), {
      since,
    }).toBe('Notes of paper');
    await alex.page.keyboard.press('Escape');

    // --- delete ---
    since = Date.now();
    await deleteButton(alex.page).click();
    await expectEventually('Sam sees the note go away', () => pageNoteCount(sam), {
      since,
    }).toBe(0);
    await expectEventually('and Sam stops painting it', () => painted(sam), { since }).toBe(0);

    await expectConverged('both boards are the same board at the end', [alex, sam]);
    expectNoConsoleErrors(alex, sam);
  });

  test('TC-23: two people type into one note at the same time and every character survives', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];
    const id = await createNote(alex.page, NOTE_AT, WORDS.base);
    await expectEventually('Sam sees the note', () => pageNoteCount(sam)).toBe(1);

    // Both open the same note, then both type without waiting for the other. This is the
    // case the merge exists for: one piece of text, two carets, two places at once.
    await editNoteById(alex, id);
    await editNoteById(sam, id);
    await Promise.all([
      alex.page.keyboard.type(WORDS.alex, { delay: 30 }),
      sam.page.keyboard.type(WORDS.sam, { delay: 30 }),
    ]);

    await expectConverged('the two copies of the note agree', [alex, sam], { timeoutMs: 20_000 });
    const expected = characters(WORDS.base + WORDS.alex + WORDS.sam);
    for (const participant of [alex, sam]) {
      const text = await textOf(participant, id);
      expect(
        characters(text ?? ''),
        `${participant.name} has every character both people typed, and no others`,
      ).toBe(expected);
    }
    expectNoConsoleErrors(alex, sam);
  });

  test('TC-24: two people drag the same note at once and end up with one position', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];
    const id = await createNote(alex.page, NOTE_AT, 'shared');
    await expectEventually('Sam sees the note', () => pageNoteCount(sam)).toBe(1);

    const before = await positionOf(sam, id);
    // Two hands, one note, no coordination: Alex pulls it right, Sam pulls it down.
    await Promise.all([
      dragNoteById(alex, id, DRAG_RIGHT, 0),
      dragNoteById(sam, id, 0, DRAG_DOWN),
    ]);

    await expectConverged('both boards settle on one position for the note', [alex, sam]);
    const after = await positionOf(alex, id);
    expect(after, 'the note was moved by at least one of them').not.toEqual(before);
    expect(await positionOf(sam, id), 'and both agree where it ended up').toEqual(after);
    expectNoConsoleErrors(alex, sam);
  });

  test('TC-25: the person typing into a note sees it go when somebody else deletes it', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];
    const id = await createNote(alex.page, NOTE_AT, 'doomed');
    await expectEventually('Sam sees the note', () => pageNoteCount(sam)).toBe(1);

    await editNoteById(sam, id);
    expect(await isEditingOnPage(sam), 'Sam is typing into it').toBe(true);

    const since = Date.now();
    await deleteButton(alex.page).click();

    await expectEventually('the note disappears from Sam too', () => pageNoteCount(sam), {
      since,
    }).toBe(0);
    await expectEventually('and so does the text box they were typing in', () => isEditingOnPage(sam), {
      since,
    }).toBe(false);
    await expectEventually('and Sam stops painting it', () => painted(sam), { since }).toBe(0);

    await expectConverged('both boards are empty together', [alex, sam]);
    expectNoConsoleErrors(alex, sam);
  });

  test('TC-28: you see what the other person typed, not what they have selected', async ({
    browser,
  }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];
    const id = await createNote(alex.page, NOTE_AT, 'yours');
    await expectEventually('Sam sees the note', () => pageNoteCount(sam)).toBe(1);

    await editNoteById(alex, id);
    await alex.page.keyboard.type(' and mine');
    expect(await isSelectedOnPage(alex), 'Alex sees their own selection').toBe(true);
    expect(await isEditingOnPage(alex), 'Alex has a text box open').toBe(true);

    // Sam sees the text, and nothing of Alex's selection: no outline, no caret, no text
    // box. What is shared is the board, not the two people looking at it.
    await expectEventually('Sam sees the text Alex typed', () => textOf(sam, id)).toBe(
      'yours and mine',
    );
    expect(
      await isSelectedOnPage(sam, await paintedIndexOf(sam, id)),
      'Sam sees no selection outline of Alex',
    ).toBe(false);
    expect(await isEditingOnPage(sam), 'Alex did not open a text box on Sam').toBe(false);
    expect(
      (await paintedNotes(sam).allTextContents()).join(' '),
      'the text itself is painted for Sam',
    ).toContain('and mine');
    expect(await editor(sam.page).count(), 'Sam has no editor').toBe(0);

    // And the same the other way round.
    await editNoteById(sam, id);
    expect(await isSelectedOnPage(alex), 'Alex still has their own selection, not Sam').toBe(true);
    expect(await isSelectedOnPage(sam), 'Sam has their own now').toBe(true);
    await expectConverged('the same note, selected by two people at once', [alex, sam]);
    expectNoConsoleErrors(alex, sam);
  });
});

/** Where a note sits among the notes this page paints (paint order, not stacking). */
// ---------------------------------------------------------------------------
// Workflow: full-capacity session (TC-26)
// ---------------------------------------------------------------------------

test.describe('full-capacity session', () => {
  test('TC-26: a board full of people, every one of whom sees everything the others do', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const crowd = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    people = crowd;
    // Everyone looks at the same wide view, so a board full of notes fits on one screen
    // and every note can be grabbed where it is painted. The camera is each page's own
    // business; setting it identically is what makes the screens comparable.
    await Promise.all(crowd.map((participant) => aimCamera(participant, WIDE)));

    // Each person makes five notes, all at the same time, each in their own patch.
    for (let round = 0; round < 5; round += 1) {
      const since = Date.now();
      await Promise.all(
        crowd.map((participant, person) =>
          createNote(participant.page, spot(person, round), `${participant.name}${round + 1}`),
        ),
      );
      const expected = (round + 1) * crowd.length;
      for (const watcher of crowd) {
        // Every change seen by all others: one measurement per pair of people.
        await expectEventually(
          `${watcher.name} sees everyone's note number ${round + 1}`,
          () => pageNoteCount(watcher),
          { since },
        ).toBe(expected);
      }
    }

    // Then each person moves each of their own five notes.
    for (let round = 0; round < 5; round += 1) {
      const since = Date.now();
      await Promise.all(
        crowd.map(async (participant) => {
          const id = await noteMadeBy(participant, round);
          await dragNoteById(participant, id, 40, 40);
        }),
      );
      await expectConverged(`everybody agrees after move ${round + 1}`, crowd, { since });
    }

    const [first] = crowd;
    const shared = await snapshotKey(first as Participant);
    for (const participant of crowd) {
      expect(await snapshotKey(participant), `${participant.name}'s board is identical`).toBe(shared);
    }
    expect(await pageNoteCount(first as Participant)).toBe(5 * crowd.length);
    expectNoConsoleErrors(...crowd);
  });
});

/**
 * One person's patch of the board, and a row for each note they make.
 *
 * These are places for a board that is zoomed out (see WIDE): a note is
 * STICKY_SIZE_WORLD across, so at that zoom they sit apart. On a board at its normal
 * zoom the same grid would put every double-click on top of the note before it, which
 * edits that note instead of making a new one — see `deskSpot`.
 */
function spot(person: number, round: number): { x: number; y: number } {
  return { x: 120 + person * 90, y: 120 + round * 90 };
}

/**
 * Places for the outage test's notes, on a board at its normal zoom: a note is 200 board
 * units wide and tall there, so these are far enough apart that every double-click finds
 * empty board, and nobody's note lands under somebody else's cursor.
 */
function deskSpot(person: number, round: number): { x: number; y: number } {
  return { x: 150 + person * 420, y: 140 + round * 230 };
}

/** The note a person made in a given round, found by the words only they typed in it. */
async function noteMadeBy(participant: Participant, round: number): Promise<string> {
  const label = `${participant.name}${round + 1}`;
  const note = (await documentOf(participant)).find((entry) => entry.text === label);
  if (!note) throw new Error(`${participant.name} has no note labelled ${label}`);
  return note.id;
}

// ---------------------------------------------------------------------------
// Workflow: flaky wi-fi (TC-27)
// ---------------------------------------------------------------------------

test.describe('flaky wi-fi', () => {
  test('TC-27: a board that loses its connection catches up, and says so out loud', async ({
    browser,
  }) => {
    // The outage lasts CATCH_UP_TEST_OUTAGE_MS, and a client that was cut off waits out
    // its own retry schedule before dialling again. Both are the product's timings, so
    // this test cannot be as quick as the others.
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + RECONNECT_WAIT_MS + 120_000);

    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];

    const outage = Date.now();
    await goOffline(alex);

    // Both keep working through the outage. Alex's notes cannot get out, and Sam's cannot
    // get in; each page carries on as a board, because that is what it is for. One person
    // makes one note at a time — a page has one toolbar and one caret — while the two of
    // them work alongside each other, which is the shape of the outage the story describes.
    for (const round of [0, 1, 2]) {
      await Promise.all([
        createNote(alex.page, deskSpot(0, round), `offline ${round + 1}`),
        createNote(sam.page, deskSpot(1, round), `online ${round + 1}`),
      ]);
    }
    await expectEventually('Alex notices the outage', () => badgeText(alex)).toBe('Reconnecting…');

    // The outage has to be longer than the client's retry schedule for the catch-up to be
    // a catch-up rather than a lucky moment, so it is held for its full length.
    const held = Date.now() - outage;
    if (held < CATCH_UP_TEST_OUTAGE_MS) await sam.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS - held);
    expect(await badgeText(alex), 'still cut off, still saying so').toBe('Reconnecting…');
    expect(await connectionState(alex)).toBe('reconnecting');
    expect(await pageNoteCount(alex), 'Alex has three notes of their own and none of Sam').toBe(
      3,
    );
    expect(await pageNoteCount(sam), 'and Sam has never heard of them').toBe(3);

    await goOffline(alex, false);

    // The return is as visible as the loss was: "Connected", for CONNECTED_CONFIRMATION_MS
    // — long enough to be noticed, short enough to stop being in the way — and then quiet.
    await expectEventually('Alex says it is back', () => badgeText(alex), {
      timeoutMs: RECONNECT_WAIT_MS,
    }).toBe('Connected');
    // The wait that follows is bounded by the promise the badge makes: it is on screen for
    // CONNECTED_CONFIRMATION_MS, and the test looks for its absence no later than that plus
    // a few polls. A badge that stayed up forever would fail here rather than pass quietly.
    await expectEventually(
      'the badge goes quiet once it has made its point',
      () => badgeText(alex),
      { timeoutMs: CONNECTED_CONFIRMATION_MS + 5_000 },
    ).toBeNull();
    await expectEventually('and everything both of them wrote arrives', () =>
      Promise.all([pageNoteCount(alex), pageNoteCount(sam)]),
    ).toEqual([6, 6]);
    await expectConverged('the two boards are one board again', [alex, sam]);
    expect(await pageNoteCount(sam)).toBe(6);
  });
});

/** Notes are painted as text boxes; a page that paints none has nobody typing in it. */
async function paintedTextOf(participant: Participant): Promise<string> {
  return (await paintedNotes(participant).allTextContents()).join(' | ');
}

test('the note text a person pastes is what the other person sees, letter for letter', async ({
  browser,
}) => {
  const [alex, sam] = await openParticipants(browser, 2);
  people = [alex, sam];
  const id = await createNote(alex.page, NOTE_AT, 'paste');
  await expectEventually('Sam sees the note', () => pageNoteCount(sam)).toBe(1);

  // A paste is the other end of the typing spectrum: one change, a lot of text in it.
  await editNoteById(alex, id);
  await pasteIntoEditor(alex.page, 'the quick brown fox');
  await expectEventually('Sam sees the whole paste', () => textOf(sam, id)).toBe(
    'the quick brown fox',
  );
  expect(await paintedTextOf(sam)).toContain('the quick brown fox');
  await expectConverged('both boards hold the same text', [alex, sam]);
  expectNoConsoleErrors(alex, sam);
});


// ---------------------------------------------------------------------------
// Nightly (TC-29, TC-30): the two checks that are too slow for every commit
//
// Both carry the `@nightly` tag: the default projects filter it out and
// `npm run test:e2e:nightly` runs nothing else. Their lengths are the ones the design
// asks for — 45 s of doing nothing, 60 s of being edited — and each can be shortened by
// an environment variable, which exists so that the tests can be tried at all; nightly
// runs them at full length.
// ---------------------------------------------------------------------------

/** How long two people leave the board alone (TC-29): 45 s of nothing. */
const IDLE_MS = msFromEnv('NIGHTLY_IDLE_MS', 45_000);
/** How long a full board of people keeps editing (TC-30): 60 s of edits. */
const SOAK_MS = msFromEnv('NIGHTLY_SOAK_MS', 60_000);
/** How often the idle board is looked at, while it is being left alone. */
const IDLE_POLL_MS = 500;
/** The soak's numbers come from here, so a failure can be replayed. */
const SOAK_SEED = 20260823;
/** Places for soak notes: enough room that no two notes of one person overlap. */
const SOAK_SLOTS = 6;

/** The design's lengths, in milliseconds, with an override so the tests can be tried. */
function msFromEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

test.describe('nightly', () => {
  test('TC-29 @nightly: a board two people leave open never mentions its connection', async ({
    browser,
  }) => {
    test.setTimeout(IDLE_MS + 180_000);
    const [alex, sam] = await openParticipants(browser, 2);
    people = [alex, sam];

    // A page that reloaded would lose this, and would land on a different board while at
    // it (a test build opened at `/` makes a new one), so this looks for the reload
    // itself rather than inferring it from the board being wrong.
    for (const participant of [alex, sam]) {
      await participant.page.evaluate(() => {
        (window as unknown as { __nightlyPage?: number }).__nightlyPage = 1;
      });
    }

    // The claim is about the whole period, not about a moment in it, so the two pages are
    // looked at continuously and every utterance about the connection is written down.
    // Nothing at all is done to the boards meanwhile: no typing, no clicking, no reload.
    const spoke: string[] = [];
    const watching = Date.now();
    while (Date.now() - watching < IDLE_MS) {
      for (const participant of [alex, sam]) {
        const shown = await badgeText(participant);
        if (shown !== null) {
          spoke.push(`${participant.name}: the badge said "${shown}" while nothing was happening`);
        }
        const state = await connectionState(participant);
        if (state !== 'connected') {
          spoke.push(
            `${participant.name}: the connection was "${String(state)}" while nothing was happening`,
          );
        }
      }
      await alex.page.waitForTimeout(IDLE_POLL_MS);
    }
    expect(
      spoke,
      `an idle board is entitled to be quiet (${IDLE_MS / 1000} s of watching two people do nothing)`,
    ).toEqual([]);

    for (const participant of [alex, sam]) {
      expect(
        await participant.page.evaluate(() => (window as unknown as { __nightlyPage?: number }).__nightlyPage),
        `${participant.name}'s page never reloaded`,
      ).toBe(1);
    }

    // Quiet has to mean "sitting on a live connection", not "a connection that stopped
    // talking". One change after the idling settles whether the two boards still speak.
    const since = Date.now();
    const id = await createNote(alex.page, NOTE_AT, 'still here');
    await expectEventually('a change made after idling arrives', () => textOf(sam, id), {
      since,
    }).toBe('still here');
    await expectConverged('the two boards are the same board after idling', [alex, sam]);
    expectNoConsoleErrors(alex, sam);
  });

  test('TC-30 @nightly: a capacity soak, in which every change arrives on every other screen', async ({
    browser,
  }) => {
    test.setTimeout(SOAK_MS + 300_000);
    const crowd = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    people = crowd;
    // Everyone looks at the same wide view, so everyone's notes are reachable on
    // everyone's screen. The camera is each page's own business; see TC-26.
    await Promise.all(crowd.map((participant) => aimCamera(participant, WIDE)));

    const roll = seededRolls(SOAK_SEED);
    const notes = crowd.map((): SoakNote[] => []);
    const changes: string[] = [];

    const soak = Date.now();
    let rounds = 0;
    while (Date.now() - soak < SOAK_MS) {
      rounds += 1;
      // One change from each person at a time, at the same moment: the room is applying
      // five changes and relaying twenty while this round is being measured.
      const due = await Promise.all(
        crowd.map(async (participant, person) => {
          const mine = notes[person] as SoakNote[];
          const change = await soakChange(participant, person, rounds, mine, roll);
          changes.push(change.log);
          return change;
        }),
      );

      // Every one of those changes has to reach every other screen, and look like it does
      // on the screen that made it. Each is measured from the moment it was made, so a
      // round is five measurements and not one average of whoever was slowest.
      for (const change of due) {
        const others = crowd.filter((other) => other !== change.who);
        await Promise.all(
          others.map((other) =>
            expectEventually(
              `${change.who.name}'s ${change.what} reaches ${other.name} (round ${rounds})`,
              () => appearanceOf(other, change.id),
              { since: change.at },
            ).toBe(change.expected),
          ),
        );
      }
      // Progress, every ten rounds: a run that stops is a run you want to know stopped.
      if (rounds % 10 === 0) {
        console.log(
          `  [soak] round ${rounds} at ${(Date.now() - soak) / 1000} s: ${due.map((change) => change.what).join(', ')}`,
        );
      }
    }

    // Nothing was lost on the way: whatever the screens hold at the end is what each
    // person last wrote, on every screen, and all of them agree.
    const every = notes.flat();
    for (const note of every) {
      for (const participant of crowd) {
        expect(
          await appearanceOf(participant, note.id),
          `${participant.name} still shows ${note.made} as it was last left`,
        ).toBe(appearance(note));
      }
    }
    await expectConverged(`after ${rounds} rounds everybody holds one board`, crowd);
    console.log(
      `\nsoak: ${rounds} rounds × ${crowd.length} people (${SOAK_MS / 1000} s), ` +
        `${changes.length} changes, ${every.length} notes left on the board — ${describeRolls(SOAK_SEED)}\n`,
    );
    logLatencies(
      `capacity soak (TC-30): time from a change to it appearing on every other screen, ` +
        `${crowd.length} people, ${rounds} rounds`,
    );
    expectNoConsoleErrors(...crowd);
  });
});

/** What one person might do next. */
type SoakKind = 'type' | 'move' | 'recolour' | 'create' | 'delete';

/**
 * What people do on a board, in proportion: mostly typing, some arranging, an occasional
 * note made and an occasional one thrown away. The weights are the ones in the design's
 * soak (TC-30: "continuous seeded random edits"), so the board the soak leaves behind is
 * the same board every run with the same seed leaves behind.
 */
function soakKind(dice: number): SoakKind {
  const choices: readonly (readonly [SoakKind, number])[] = [
    ['type', 0.35],
    ['move', 0.25],
    ['recolour', 0.15],
    ['create', 0.12],
    ['delete', 0.13],
  ];
  let edge = 0;
  for (const [kind, weight] of choices) {
    edge += weight;
    if (dice < edge) return kind;
  }
  return 'delete';
}

/**
 * A note in the soak's own memory: what it is, who made it, and which of its maker's
 * places it stands in. The place is remembered because a note is placed by *screen*
 * point (the double-click that makes one is a screen event) while the board holds world
 * coordinates, and the two are only related by this page's camera.
 */
interface SoakNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  slot: number;
  made: string;
}

/** One change, and what every other screen must come to show. */
interface SoakChange {
  who: Participant;
  id: string;
  /** What was done, for the latency line: "note", "text", "colour", "move", "delete". */
  what: string;
  /** The appearance every other screen must reach, or null when the note is gone. */
  expected: string | null;
  /** When this change was made, which is where the wait for it starts being counted. */
  at: number;
  log: string;
}

/**
 * Carries out one person's next change, and stamps it with the moment it was made.
 *
 * The stamp matters: five people doing five different things at once take different times
 * to do them, and the board's speed has nothing to do with how long a double-click, a drag
 * or a line of typing takes. Measuring from the change rather than from the round is what
 * makes the latency line in the report about the board.
 */
async function soakChange(
  participant: Participant,
  person: number,
  round: number,
  mine: SoakNote[],
  roll: () => number,
): Promise<SoakChange> {
  const change = await soakEdit(participant, person, round, mine, roll);
  return { ...change, at: Date.now() };
}

/**
 * What one page shows of one note: its words, its colour and its place, as one string, so
 * that a change of any kind is awaited the same way. Null when there is no such note.
 */
function appearanceOf(participant: Participant, id: string): Promise<string | null> {
  return documentOf(participant).then((notes) => {
    const note = notes.find((each) => each.id === id);
    if (!note) return null;
    return `${note.text}|${note.color}|${note.x.toFixed(2)},${note.y.toFixed(2)}`;
  });
}

function appearance(note: SoakNote): string {
  return `${note.text}|${note.color}|${note.x.toFixed(2)},${note.y.toFixed(2)}`;
}

/**
 * One person's next change, chosen from the run's own stream of numbers and carried out
 * through the real interface: the toolbar, the pointer, the text box, the delete button.
 */
async function soakEdit(
  participant: Participant,
  person: number,
  round: number,
  mine: SoakNote[],
  roll: () => number,
): Promise<Omit<SoakChange, 'at'>> {
  let kind = soakKind(roll());
  // Two rules about room: whoever has no notes can only make one, and a person never holds
  // more than SOAK_SLOTS, because the screen has only so many places to put them.
  if (mine.length === 0) kind = 'create';
  else if (mine.length >= SOAK_SLOTS && kind === 'create') kind = 'type';
  await clearSelection(participant);

  const words = ['leaf', 'stone', 'river', 'cloud', 'ferry', 'lantern', 'meadow', 'harbour'];
  const colours = Object.keys(STICKY_COLORS);

  if (kind === 'create') {
    const slot = firstFreeSlot(mine);
    const label = `${participant.name}-${round}-${(roll() * 1000) | 0}`;
    await createNote(participant.page, soakSpot(person, slot), label);
    const made = (await documentOf(participant)).find((note) => note.text === label);
    if (!made) {
      throw new Error(
        `${participant.name} made no note called ${label} at slot ${slot}; the board holds ` +
          (await documentOf(participant)).map((note) => note.text || '(empty)').join(', '),
      );
    }
    const note: SoakNote = {
      id: made.id,
      text: made.text,
      color: made.color,
      x: made.x,
      y: made.y,
      slot,
      made: `${participant.name}'s note ${label}`,
    };
    mine.push(note);
    return {
      who: participant,
      id: note.id,
      what: 'note',
      expected: appearance(note),
      log: `round ${round}: ${participant.name} made a note called ${label}`,
    };
  }

  const note = mine[(round * 7 + person) % mine.length] as SoakNote;

  if (kind === 'type') {
    const word = ` ${words[round % words.length] as string}`;
    await editNoteById(participant, note.id);
    await participant.page.keyboard.type(word);
    await participant.page.keyboard.press('Escape');
    note.text = `${note.text}${word}`;
    return {
      who: participant,
      id: note.id,
      what: 'text',
      expected: appearance(note),
      log: `round ${round}: ${participant.name} typed "${word.trim()}" into ${note.made}`,
    };
  }

  if (kind === 'move') {
    // A move takes the note back to the place its maker made it in, or nudges it out of
    // that place if it is already standing there. So notes wander within a nudge of home
    // for the whole soak instead of drifting off the screen, which a longer test would
    // otherwise end with: a note nobody can reach is a note nobody can check.
    const home = soakSpot(person, note.slot);
    const centre = await centreOf(participant, note.id);
    const away = Math.abs(home.x - centre.x) > 2 || Math.abs(home.y - centre.y) > 2;
    const dx = away ? home.x - centre.x : NUDGE;
    // Home if it is anywhere out of place, otherwise a nudge sideways. A note is only ever
    // within a nudge of its own place, so it stays where the soak can reach it: a note that
    // drifts away is a note nobody can check, and a long run ends with one.
    const dy = away ? home.y - centre.y : 0;
    await dragNoteById(participant, note.id, dx, dy);
    const moved = await documentOf(participant).then((notes) =>
      notes.find((each) => each.id === note.id),
    );
    if (!moved) throw new Error(`${participant.name} moved a note that has gone missing`);
    note.x = moved.x;
    note.y = moved.y;
    return {
      who: participant,
      id: note.id,
      what: 'move',
      expected: appearance(note),
      log: `round ${round}: ${participant.name} moved ${note.made} ${away ? 'home' : 'aside'}`,
    };
  }

  if (kind === 'recolour') {
    const color = colours[(round + person) % colours.length] as string;
    await selectNoteById(participant, note.id);
    await swatch(participant.page, color).click();
    note.color = color;
    return {
      who: participant,
      id: note.id,
      what: 'colour',
      expected: appearance(note),
      log: `round ${round}: ${participant.name} turned ${note.made} ${color}`,
    };
  }

  await selectNoteById(participant, note.id);
  await deleteButton(participant.page).click();
  mine.splice(mine.indexOf(note), 1);
  return {
    who: participant,
    id: note.id,
    what: 'delete',
    expected: null,
    log: `round ${round}: ${participant.name} deleted ${note.made}`,
  };
}

/** How far a note with nowhere to go is nudged, in screen pixels: sideways, into the gap. */
const NUDGE = 25;

/** Rows of the soak grid, in screen pixels: a note paints 60 px tall at WIDE's zoom. */
const SOAK_ROW = 120;

/** Columns of the soak grid, in screen pixels: a note paints 60 px wide at WIDE's zoom. */
const SOAK_COLUMN = 90;

/**
 * A point on the screen where there is never a note: the soak's grid stops well short of
 * it, so a click there puts the board's selection down and lets the next click reach a
 * note. A selected note carries its own little toolbar, and that toolbar overhangs the
 * note it belongs to far enough to be in the way of a click aimed at a neighbour. This is
 * a per-page affair — the selection is nobody else's business (TC-28) — so clearing it
 * here changes only the page doing the clicking.
 */
const CLEAR_PLACE = { x: 1050, y: 740 };

async function clearSelection(participant: Participant): Promise<void> {
  await board(participant.page).click({ position: CLEAR_PLACE });
  await settled(participant.page);
}

/**
 * Where a person's notes go, as points on the screen: one column each, one row per note.
 *
 * These are screen points, because that is what a double-click takes. Rows are 120 px apart
 * for notes that paint 60 px tall at WIDE's zoom, which leaves the space above a note for
 * the toolbar that appears when it is selected: that toolbar keeps its size at every zoom
 * (it is scaled by the reciprocal, so it stays readable when the board is not), and a
 * toolbar with nowhere to go lies over the note above and takes that note's clicks. Columns
 * are 90 px apart, which is enough for the notes themselves, because the toolbar of a
 * selected note is the only thing in the space above it and only one note is ever selected
 * on a page at a time.
 */
function soakSpot(person: number, slot: number): { x: number; y: number } {
  return { x: 120 + person * SOAK_COLUMN, y: 120 + slot * SOAK_ROW };
}

/** The first of a person's places that no note of theirs is standing in. */
function firstFreeSlot(mine: readonly SoakNote[]): number {
  const taken = new Set(mine.map((note) => note.slot));
  for (let slot = 0; slot < SOAK_SLOTS; slot += 1) {
    if (!taken.has(slot)) return slot;
  }
  throw new Error('every place on the board is taken');
}

/**
 * The soak's numbers: a linear congruential generator, so that the whole run is
 * reproducible from SOAK_SEED and a failure can be replayed by quoting the seed.
 */
function seededRolls(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function describeRolls(seed: number): string {
  return `seed ${seed}`;
}
