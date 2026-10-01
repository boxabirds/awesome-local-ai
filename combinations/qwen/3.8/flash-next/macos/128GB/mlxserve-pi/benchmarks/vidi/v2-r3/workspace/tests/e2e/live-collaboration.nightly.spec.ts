// Story 3, nightly e2e: the two checks that are too slow for every commit.
//
// Both are about `connectBoard`'s connection rather than about a change:
//
//   * TC-29 leaves a board alone for longer than either side's idea of a dead
//     connection and asks that nobody was ever told it was lost. What keeps an
//     idle connection alive here is the presence traffic the room relays back to
//     every socket, so a room that stopped relaying it would drop its editors
//     after half a minute of quiet — which is exactly the half minute this waits.
//   * TC-30 keeps the designed full complement of editors editing for a minute,
//     from a seed, and asks that everything they did arrives everywhere. The
//     latency of every one of those changes is measured and printed; none of it
//     is asserted, because the model, the browsers and the room all share this
//     one machine (design: Timing policy).
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_STICKY_COLOR, MAX_CONCURRENT_EDITORS, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { setCamera, settle } from './helpers/board';
import {
  clickNote,
  deleteButton,
  dragNote,
  editor,
  noteText,
  swatch,
  topNoteIdAt,
  type ScreenPoint,
} from './helpers/stickies';
import {
  badgesSeen,
  connectionStateOf,
  expectChangeSeen,
  expectNoProblems,
  expectSameBoard,
  joinBoard,
  leaveAll,
  measurements,
  newBoard,
  noteCountOf,
  noteKeyOf,
  reportLatency,
  statesSeen,
  watchConnection,
  watchNotes,
  type Person,
} from './helpers/participants';

/**
 * Longer than the 30 seconds y-websocket waits before it gives up on a socket it
 * has heard nothing from, and longer than the 10 second ceiling on reconnection
 * (RECONNECT_MAX_BACKOFF_MS), so an idle board that is quietly being kept alive
 * is distinguished from one that is quietly dying.
 */
const IDLE_WAIT_MS = 45_000;

/** How long the full complement of editors keeps editing for. */
const SOAK_MS = 60_000;

/**
 * One number decides every edit the soak makes, so a run can be had back. It is
 * printed at the start of the run for the same reason.
 */
const SOAK_SEED = 20_261_001;

/** Half size, so five people each have a row of their own to work in. */
const ZOOM = 0.5;
const SCREEN = { width: 1280, height: 800 };
const centredAt = (zoom: number) => ({ x: -SCREEN.width / 2 / zoom, y: -SCREEN.height / 2 / zoom, zoom });

/**
 * Where a person's notes live: a row of their own, far enough from the board
 * toolbar on the left and the zoom control on the bottom right that nothing they
 * click is ever a piece of the interface, and far enough apart that a note is
 * never dropped on top of another one.
 */
const CELLS_EACH = 6;
const cellAt = (person: number, cell: number) => ({ x: 140 + cell * 160, y: 140 + person * 130 });

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** A reproducible sequence of numbers in [0,1) from a seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe('nightly', () => {
  test('TC-29 a board nobody touches stays connected', async ({ browser, request }) => {
    test.setTimeout(IDLE_WAIT_MS + 120_000);
    const board = await newBoard(request);
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    // Both of them are listening for what the connection says, for the whole of
    // the wait: the badge is up for two seconds and a dropped connection can be
    // shorter than any interval a test would think to poll at.
    await watchConnection(alex.page);
    await watchConnection(sam.page);

    // Nobody does anything.
    await alex.page.waitForTimeout(IDLE_WAIT_MS);

    for (const person of [alex, sam]) {
      // The connection never left the state it reached when the board was agreed,
      // and never said anything about losing it.
      const states = await statesSeen(person.page);
      expect(states).toContain('connected');
      expect(states).not.toContain('reconnecting');
      expect(states[states.length - 1]).toBe('connected');
      const badges = await badgesSeen(person.page);
      expect(badges).not.toContain('Reconnecting…');
      expect(badges).not.toContain('Connected');
      expect(await connectionStateOf(person.page)).toBe('connected');
      // A board that is fine says nothing: the badge is not on screen.
      expect(await person.page.locator('[data-testid="connection-status"]').count()).toBe(0);
    }
    // And the board itself is untouched and still being shared: a change made
    // after the wait still travels, which is the only way to know the connection
    // was live rather than merely quiet.
    await watchNotes(alex.page);
    await watchNotes(sam.page);
    const sent = Date.now();
    const id = await makeNote(alex.page, { x: 640, y: 400 }, 'still here');
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'a note made after 45 seconds of quiet');

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });

  test('TC-30 everybody keeps editing for a minute and everything arrives everywhere', async ({ browser, request }) => {
    test.setTimeout(SOAK_MS + 300_000);
    const board = await newBoard(request);
    const names = ['Ana', 'Bo', 'Cy', 'Di', 'Eli'].slice(0, MAX_CONCURRENT_EDITORS);
    const soakers = [];
    for (const [index, name] of names.entries()) {
      const person = await joinBoard(browser, name, board);
      await setCamera(person.page, centredAt(ZOOM));
      await settle(person.page);
      await watchNotes(person.page);
      soakers.push({
        person,
        index,
        /** Where this person's notes are, one place per cell, null when nobody is using it. */
        cells: Array.from({ length: CELLS_EACH }, () => null) as (string | null)[],
        /** How many times each of this person's notes has been painted, which decides the next colour. */
        paints: new Map<string, number>(),
        /** How many notes this person has made, which is what their notes say. */
        made: 0,
      });
    }
    console.log(`TC-30 soak: ${names.length} editors, seed ${SOAK_SEED}, ${SOAK_MS / 1000} seconds of editing`);

    const started = Date.now();
    let edits = 0;
    const kinds = new Map<string, number>();
    let round = 0;
    while (Date.now() - started < SOAK_MS) {
      // Everyone edits at the same time, each in their own notes: what one person
      // is doing is never what another person is measuring.
      const made = await Promise.all(
        soakers.map((soaker) => edit(soaker, seeded(SOAK_SEED + round * 977 + soaker.index))),
      );
      for (const [index, change] of made.entries()) {
        if (change === null) continue;
        edits++;
        kinds.set(change.kind, (kinds.get(change.kind) ?? 0) + 1);
        for (const [otherIndex, other] of soakers.entries()) {
          if (otherIndex === index) continue;
          await expectChangeSeen(
            other.person,
            change.id,
            change.key,
            change.sent,
            `${soakers[index]!.person.name} ${change.kind} → ${other.person.name}`,
          );
        }
        // Only now is this edit put back, if it is one that gets put back: a
        // screen draws what the document looks like once the messages in one
        // batch have been applied, so an edit undone straight away is an edit
        // nobody else ever gets shown.
        if (change.finish !== undefined) await change.finish();
      }
      round++;
    }
    const elapsed = Date.now() - started;

    // Everything everybody did is on every screen, and every screen draws the
    // same board: the same notes, in the same places, in the same colours, with
    // the same words, in the same order.
    const people = soakers.map((soaker) => soaker.person);
    await expectSameBoard(people, 'the board five people spent a minute editing');
    const notes = await noteCountOf(people[0]!.page);
    expect(notes).toBeGreaterThan(0);
    // Every note still on the board says what whoever typed into it typed:
    // nothing was lost on its way round.
    for (const soaker of soakers) {
      for (const id of soaker.cells.filter((id): id is string => id !== null)) {
        const text = await noteText(soaker.person.page, id);
        expect(text.startsWith(soaker.person.name)).toBe(true);
      }
    }

    const tally = Array.from(kinds.entries())
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ');
    console.log(
      `\nTC-30 soak: ${edits} edits by ${names.length} contexts in ${Math.round(elapsed / 100) / 10}s` +
        ` (${tally}); ${notes} notes left on the board; seed ${SOAK_SEED}`,
    );
    reportLatency(`TC-30 latency, ${measurements().length} changes from one screen to another`);

    await expectNoProblems(people);
    await leaveAll(people);
  });
});

/**
 * Make a note in one of this person's places and say which note it is.
 *
 * Not `createNoteAt`, which works out the new note by counting how many notes
 * there were and expecting one more: with five people making notes in the same
 * moment, how many notes there are is not something one page can predict. The
 * words a note says are this soak's own and never repeated, so the note that
 * says them is the one that was just made.
 */
async function makeNote(page: Page, at: ScreenPoint, text: string): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  // Which note is mine? The one that says these words. They are looked for in
  // one pass of the page rather than note by note, because somebody else may be
  // throwing a note away at this very moment and a note that walks off between
  // looking at it and reading it is not a note worth failing over.
  for (let attempt = 0; attempt < 20; attempt++) {
    const mine = await page.evaluate((text: string) => {
      const el = [...document.querySelectorAll('[data-note-id]')].find(
        (candidate) => candidate.querySelector('.sticky-text')?.textContent === text,
      );
      return el?.getAttribute('data-note-id') ?? null;
    }, text);
    if (mine !== null) return mine;
    await page.waitForTimeout(50);
  }
  throw new Error(`nothing on the board says ${text} — the soak's words have to be unique`);
}

/** One person's edit, and the state it put the note into. */
interface Change {
  kind: string;
  id: string;
  /** The note as this person's own screen draws it now ('gone' once deleted). */
  key: string;
  /** The moment the edit was made, which is where its latency is measured from. */
  sent: number;
  /** What to do with this note once every other screen has seen the edit. */
  finish?(): Promise<void>;
}

type Soaker = {
  person: Person;
  index: number;
  cells: (string | null)[];
  /** How many times each of this person's notes has been painted. */
  paints: Map<string, number>;
  made: number;
};

/**
 * Make one of this person's edits, chosen by `r` from the ones that make sense
 * right now — a note is only moved, painted, typed into or thrown away if there
 * is one to do it to, and a note is only created where one fits.
 *
 * Every edit it reports is a change the other screens have not been shown yet,
 * so that measuring it means something: a note is never painted the colour it
 * already is, never dragged nowhere, and a note that was moved is only put back
 * once everybody has seen where it went (which is what `finish` is for).
 */
async function edit(soaker: Soaker, r: () => number): Promise<Change | null> {
  const { person, index } = soaker;
  const page = person.page;
  // Whatever was chosen before this edit is put down first, so that no click of
  // this edit lands on the toolbar of the last one.
  await page.keyboard.press('Escape');

  const live = soaker.cells.filter((id): id is string => id !== null);
  const free: number[] = [];
  for (const [cell, id] of soaker.cells.entries()) {
    if (id !== null) continue;
    // A place is only free if nothing is drawn there: a double-click on a note
    // edits that note rather than making a new one.
    if ((await topNoteIdAt(page, cellAt(index, cell))) === null) free.push(cell);
  }

  // A person with no notes can only make one; a person with notes can do any of
  // the five things to them.
  const choices = live.length === 0 ? ['create'] : ['create', 'move', 'recolour', 'type', 'delete'];
  let kind = choices[Math.floor(r() * choices.length)]!;
  if (kind === 'create' && free.length === 0) {
    // Nowhere to put a new note, so do one of the edits that needs an old one —
    // or nothing, when there is neither room for a note nor a note to edit.
    kind = live.length === 0 ? '' : ['move', 'recolour', 'type', 'delete'][Math.floor(r() * 4)]!;
  }
  if (kind === '') return null;
  const pick = <T,>(list: T[]): T => list[Math.floor(r() * list.length)]!;
  const sent = Date.now();

  switch (kind) {
    case 'create': {
      const cell = pick(free);
      const text = `${person.name}${soaker.made++}`;
      const id = await makeNote(page, cellAt(index, cell), text);
      soaker.cells[cell] = id;
      return { kind, id, key: await noteKeyOf(page, id), sent };
    }
    case 'move': {
      const id = pick(live);
      let dx = Math.round(r() * 60) - 30;
      let dy = Math.round(r() * 60) - 30;
      if (Math.abs(dx) + Math.abs(dy) < 12) {
        // A drag to nowhere is not an edit anybody could see.
        dx += 30;
        dy -= 24;
      }
      await dragNote(page, id, dx, dy);
      return {
        kind,
        id,
        key: await noteKeyOf(page, id),
        sent,
        finish: async () => {
          // And back into its own row again: a minute of editing ought to leave a
          // board a person could look at, not a heap.
          await dragNote(page, id, -dx, -dy);
        },
      };
    }
    case 'recolour': {
      const id = pick(live);
      // A note is born yellow, so a paint moves on from wherever it is now:
      // painting a note the colour it already is shows nobody anything.
      const paints = (soaker.paints.get(id) ?? 0) + 1;
      soaker.paints.set(id, paints);
      const color = COLORS[(COLORS.indexOf(DEFAULT_STICKY_COLOR) + paints) % COLORS.length]!;
      await clickNote(page, id);
      await swatch(page, color).click();
      return { kind, id, key: await noteKeyOf(page, id), sent };
    }
    case 'type': {
      const id = pick(live);
      const letter = String.fromCharCode(97 + (index % 26));
      await clickNote(page, id);
      await page.keyboard.press('Enter');
      await page.keyboard.type(letter.repeat(3));
      await page.keyboard.press('Escape');
      return { kind, id, key: await noteKeyOf(page, id), sent };
    }
    case 'delete': {
      const id = pick(live);
      await clickNote(page, id);
      await deleteButton(page).click();
      const cell = soaker.cells.indexOf(id);
      if (cell >= 0) soaker.cells[cell] = null;
      soaker.paints.delete(id);
      return { kind, id, key: await noteKeyOf(page, id), sent };
    }
    default:
      return null;
  }
}
