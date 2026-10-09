import { expect, test } from '@playwright/test';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { NOTE_WORDS, mulberry32 } from '../fixtures/random-ops';
import {
  applyChange,
  badgeSightings,
  boardMarkers,
  closeParticipants,
  createBoardLink,
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
  recolourNote,
  snapshotOf,
  typeInto,
  watchForBadge,
  type LatencySample,
  type Participant,
  type Point,
} from './helpers/participants';

/**
 * Nightly e2e for the `sync.client` contract: the two checks that are too slow to run on
 * every commit. They run through `npm run test:e2e:nightly` and are excluded from
 * `npm run test:e2e`.
 */

/** TC-29: nobody touches the board for this long. */
const IDLE_MS = 45_000;
/** How often the idle test looks at a board between the in-page badge watch and the state check. */
const IDLE_CHECK_EVERY_MS = 5_000;
/** TC-30: the room keeps editing for this long. */
const SOAK_MS = 60_000;
/** A change that has not reached a context by now is a failure, however slow the machine is. */
const CONVERGE_TIMEOUT_MS = 30_000;
/**
 * Six spots for notes to live in, far enough apart that two notes are never under the
 * same pointer, and clear of the toolbar, the zoom controls and the connection badge.
 */
const SPOTS: Point[] = [
  { x: 330, y: 220 },
  { x: 640, y: 220 },
  { x: 950, y: 220 },
  { x: 330, y: 560 },
  { x: 640, y: 560 },
  { x: 950, y: 560 },
];

/**
 * The box a note's centre stays inside, in screen coordinates — the same corners the spot
 * grid creates notes at, so a created note is inside it to begin with. Outside it, a note
 * has its colour-change toolbar under the app toolbar at the left (a recolour or delete
 * then hits the toolbar instead of the swatch), or is off the bottom of the 1280x800
 * viewport, or under the zoom control: a soak that cannot click is a soak that measures
 * nothing, for as many rounds as it takes.
 */
const SAFE = { x0: 330, y0: 220, x1: 950, y1: 560 };

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Two notes whose centres are closer than this are a pile, and a pile cannot be clicked
 * unambiguously: the click selects whichever is on top, so every later round that means
 * to work on the other one works on nothing. A little more than a note's width keeps a
 * pointer inside each note.
 */
const MIN_GAP = STICKY_SIZE_WORLD + 40;

/** Would a note parked at `topLeft` end up in a pile with `other`? */
const near = (topLeft: Point, other: Point): boolean =>
  Math.abs(topLeft.x - other.x) < MIN_GAP && Math.abs(topLeft.y - other.y) < MIN_GAP;

const short = (id: string): string => id.slice(0, 6);



test('TC-29 @nightly: a board nobody touches stays connected', async ({ browser }) => {
  test.setTimeout(300_000);
  const people = await createParticipants(browser, await createBoardLink(browser), 2);
  const [alex, sam] = people as [Participant, Participant];
  try {
    // Prove the two are connected before "nothing happens" means anything.
    await applyChange('opening note', alex, () => createNoteAtWith(alex, SPOTS[0]!), [sam]);
    for (const person of people) {
      await expectEventually(
        person.page,
        `${person.name} has nothing to report`,
        async () => (await connectionState(person.page)) === 'connected',
      );
      await watchForBadge(person.page);
    }

    // Nothing at all happens on the board for `IDLE_MS`.
    let waited = 0;
    while (waited < IDLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_CHECK_EVERY_MS));
      waited += IDLE_CHECK_EVERY_MS;
      for (const person of people) {
        expect(
          await connectionState(person.page),
          `${person.name} after ${waited}ms idle`,
        ).toBe('connected');
      }
    }
    for (const person of people) {
      expect(await badgeSightings(person.page), `${person.name} badge during idle`).toEqual([]);
    }

    // And the board still works after being left alone.
    await applyChange('note after being left alone', alex, () => createNoteAtWith(alex, SPOTS[3]!), [
      sam,
    ]);
    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-30 @nightly: a full room editing for a minute converges, with a latency report', async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const people = await createParticipants(browser, await createBoardLink(browser), MAX_CONCURRENT_EDITORS);
  const random = mulberry32(20260822);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const spotOf = new Map<string, number>();
  const samples: LatencySample[] = [];
  try {
    // Everybody is in the room and reporting nothing, which is the moment to start
    // watching for a badge that should never appear.
    for (const person of people) {
      await expectEventually(
        person.page,
        `${person.name} is connected`,
        async () => (await connectionState(person.page)) === 'connected',
      );
      await expectBadgeHidden(person.page);
      await watchForBadge(person.page);
    }
    const deadline = Date.now() + SOAK_MS;
    let round = 0;
    let skipped = 0;
    while (Date.now() < deadline) {
      round += 1;
      const sender = pick(people);
      const notes = await notesOf(sender);
      // A spot is free when nothing is standing in it — not one of the notes this soak
      // parked there, and not one somebody has dragged into it. Screen positions are what
      // a pointer cares about, and this is about where a pointer lands.
      const taken = new Set(spotOf.values());
      const markers = await boardMarkers(sender.page);
      const clearOfNotes = (spot: Point): boolean =>
        markers.every(
          (marker) => Math.abs(marker.x - spot.x) >= MIN_GAP || Math.abs(marker.y - spot.y) >= MIN_GAP,
        );
      const free = SPOTS.findIndex((spot, index) => !taken.has(index) && clearOfNotes(spot));
      let kind = pick(['create', 'move', 'type', 'recolour', 'delete'] as const);
      if (kind === 'create' && free < 0) kind = 'move';
      if (notes.length === 0) kind = 'create';

      const changedAt = Date.now();
      const note = kind === 'create' ? undefined : pick(notes);
      const description =
        kind === 'create' ? `create at spot ${free}` : `${kind} ${short(note?.id ?? '')}`;
      let skippedRound = false;
      try {
        if (kind === 'create') {
          const id = await createNoteAt(sender, SPOTS[free] ?? SPOTS[0]!);
          await endEditing(sender);
          spotOf.set(id, free);
        } else if (note) {
          if (kind === 'move') {
            // A hundred rounds of drift would walk a note out of the reachable area, and a
            // note dropped on top of another cannot be clicked unambiguously. So the move
            // is asked for in screen terms, its target kept inside the box a note's centre
            // is allowed to live in, and the move is skipped rather than made if it would
            // create a pile.
            const at = await markerPosition(sender.page, note.id);
            const wanted = {
              x: clamp(at.x + Math.round((random() - 0.5) * 80), SAFE.x0, SAFE.x1),
              y: clamp(at.y + Math.round((random() - 0.5) * 80), SAFE.y0, SAFE.y1),
            };
            const by = { x: wanted.x - at.x, y: wanted.y - at.y };
            // The pile test happens where notes are stored. Screen and world are the same
            // distance here, because the soak neither pans nor zooms.
            const candidate = { x: note.x + by.x, y: note.y + by.y };
            if (notes.some((other) => other.id !== note.id && near(candidate, other))) {
              skippedRound = true;
              skipped += 1;
              console.log(
                `[skip] ${description}: ${short(note.id)} would have been dropped on another note`,
              );
            } else {
              await moveNoteBy(sender, note.id, by);
            }
          } else if (kind === 'type') {
            await typeInto(sender, note.id, ` ${pick(NOTE_WORDS)}`);
          } else if (kind === 'recolour') {
            await recolourNote(sender, note.id, pick(Object.keys(STICKY_COLORS)));
          } else {
            await deleteNote(sender, note.id);
            spotOf.delete(note.id);
          }
        }
      } catch (error) {
        // Somebody else may have deleted this note while this round was deciding what to
        // do with it — on a shared board that is a normal outcome, so the round is
        // skipped. A note that is still there and would not budge is the failure it looks
        // like, and is raised.
        if (note && !(await notesOf(sender)).some((still) => still.id === note.id)) {
          skipped += 1;
          skippedRound = true;
          console.log(`[skip] ${description}: ${short(note.id)} had already been deleted`);
        } else {
          throw error;
        }
      }
      if (skippedRound) continue;

      // Every other context is waited for, one by one, each measured from the change.
      const expected = await snapshotOf(sender.page);
      for (const receiver of people) {
        if (receiver === sender) continue;
        await expectEventually(
          receiver.page,
          `round ${round}: ${description} by ${sender.name} reaches ${receiver.name}`,
          async () => (await snapshotOf(receiver.page)) === expected,
          CONVERGE_TIMEOUT_MS,
        );
        samples.push(
          logLatency({
            op: `${round} ${description} ${sender.name}->${receiver.name}`,
            latencyMs: Date.now() - changedAt,
            budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
          }),
        );
      }
    }

    // Everybody ends up holding the same board.
    await expectConverged(people);
    const snapshots = await Promise.all(people.map((person) => snapshotOf(person.page)));
    expect(new Set(snapshots).size).toBe(1);
    const markers = await Promise.all(people.map((person) => boardMarkers(person.page)));
    for (const marker of markers) expect(marker).toEqual(markers[0]);
    expect(round).toBeGreaterThan(1);
    logLatencySummary(samples);
    console.log(
      `[soak] ${round} rounds of change, ${skipped} of them taken over by another person's delete`,
    );
    for (const person of people) {
      expect(
        await badgeSightings(person.page),
        `${person.name} never reported a problem`,
      ).toEqual([]);
    }
    expectNoErrors(people);

    // Closing a browser is not an interruption for anybody else: the departing client
    // destroys its provider instead of reconnecting, and the rest of the room does not
    // gain a single new socket.
    const socketCounts = people.map((person) => person.sockets.length);
    await closeParticipants([people[0]!]);
    await new Promise((resolve) => setTimeout(resolve, IDLE_CHECK_EVERY_MS));
    for (const [index, person] of people.slice(1).entries()) {
      expect(
        person.sockets.length,
        `${person.name} opened no new sockets after ${people[0]!.name} left`,
      ).toBe(socketCounts[index + 1]);
      expect(await connectionState(person.page)).toBe('connected');
    }
  } finally {
    await closeParticipants(people);
  }
});

async function createNoteAtWith(person: Participant, at: Point): Promise<void> {
  await createNoteAt(person, at);
  await endEditing(person);
}
