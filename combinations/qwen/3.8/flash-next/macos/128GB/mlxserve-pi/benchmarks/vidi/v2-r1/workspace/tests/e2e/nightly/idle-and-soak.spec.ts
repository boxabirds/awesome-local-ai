// Copyright 2026 Board Room contributors. All rights reserved.
//
// The nightly half of live collaboration: the two things worth checking that no
// one wants to wait for on every commit — that a board left alone stays
// connected, and that a board full of people busy at once still ends up as one
// board. Tagged `@nightly`, run by `npm run test:e2e:nightly`, kept out of
// `npm run test:e2e`.
//
// Latency is measured and printed here, never asserted: the model, the browsers
// and the server all share one machine, so a wall-clock number taken off them is
// not a pass/fail signal (design: capacity).
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
// design.md, "Test coverage" (TC-29, TC-30).
import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../../src/shared/config';
import { setCamera } from '../helpers/board';
import { createRandom } from '../../integration/helpers/random-ops';
import {
  consoleErrorsOf,
  createNote,
  deleteNote,
  dragNote,
  expectEventually,
  openParticipants,
  printLatencyReport,
  recolour,
  sharedFieldsOf,
  sleep,
  startEditing,
  stopEditing,
  type,
  type Participant,
} from '../helpers/participants';

/** How long a board is left alone, and how often that is looked at. */
const IDLE_OBSERVATION_MS = 45_000;
const IDLE_SAMPLE_MS = 1_000;

/**
 * How long the capacity soak runs. The design asks for a 60 second round;
 * `SOAK_MS` shortens it while the soak itself is being worked on.
 */
const SOAK_MS = Number(process.env['SOAK_MS'] ?? 60_000);

/** How many notes one person keeps going at once. */
const SOAK_NOTES_PER_PERSON = 6;

/**
 * Where one person's notes live, in their own part of the world: a grid of slots,
 * each far enough from the next that a note dragged to the edge of its allowance
 * still does not touch another note — and a click, a drag or a delete always
 * lands on the note that was aimed at. The slots are the same on every screen
 * because a note stays in the page whether the camera is looking at it or not;
 * only the double-click that makes a note has to be inside this person's view.
 */
const COLUMN = 2000;
const SOAK_DRIFT_LIMIT = 60;
const SLOT_X = [140, 480, 820];
const SLOT_Y = [240, 580];

const RECONNECTING_TEXT = 'Reconnecting\u2026';

/** The colour names as the toolbar's buttons are called. */
const SWATCH_NAMES = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'] as const;

test.afterAll(() => {
  printLatencyReport('Nightly: a change, and when the next person sees it');
});

test('a board nobody touches stays connected (@nightly)', async ({ browser }) => {
  test.setTimeout(IDLE_OBSERVATION_MS + 180_000);

  const { people } = await openParticipants(browser, 2);
  const [alex, sam] = people as [Participant, Participant];

  // Nobody does anything for a while. What is asserted is that nothing happens:
  // the state stays `connected`, and the badge never says it is reconnecting.
  const observed = new Set<string>();
  const startedAt = Date.now();
  while (Date.now() - startedAt < IDLE_OBSERVATION_MS) {
    for (const person of people) {
      const state = await person.connectionState();
      if (state !== null) observed.add(state);
      expect(state, `${person.name} drifted off \`connected\` while idle`).toBe('connected');
      expect(await person.badgeText(), `${person.name}'s badge spoke up while idle`).not.toBe(
        RECONNECTING_TEXT,
      );
    }
    await sleep(IDLE_SAMPLE_MS);
  }
  expect(observed).toEqual(new Set(['connected']));

  // Tearing down is the other half of this: a person leaving destroys their
  // provider and their socket, and nobody left behind has a reason to reconnect.
  const samBefore = sam.consoleLogs.length;
  await alex.close();
  await sleep(5_000);

  const after = sam.consoleLogs
    .slice(samBefore)
    .filter((line) => /reconnect|socket|offline/i.test(line));
  expect(after, 'the person left behind started reconnecting something').toEqual([]);
  expect(await sam.connectionState()).toBe('connected');
  expect(await sam.badgeText()).toBeNull();
  expect(consoleErrorsOf([sam])).toEqual([]);
});

test('a full board of people typing at once ends as one board (@nightly)', async ({ browser }) => {
  test.setTimeout(SOAK_MS + 300_000);

  const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

  // Each person works in a column of the world that is theirs alone, so nothing
  // of theirs can ever lie under anybody else's. Where the camera is, is not
  // shared; what the board holds is.
  const ownNotes: string[][] = people.map(() => []);
  /** Which slot each note was made in, so a freed slot can be used again. */
  const slotOf = new Map<string, number>();
  /** How far each note has been dragged from where it was made. */
  const drift = new Map<string, { x: number; y: number }>();
  for (const [index, person] of people.entries()) {
    await setCamera(person.page, { x: index * COLUMN, y: -400, zoom: 1 });
  }

  /** The first slot of this person's that no note of theirs is using. */
  const freeSlot = (mine: string[]): number => {
    const taken = new Set(mine.map((id) => slotOf.get(id)));
    for (let slot = 0; slot < SLOT_X.length * SLOT_Y.length; slot += 1) {
      if (!taken.has(slot)) return slot;
    }
    throw new Error('no free slot: the soak is holding more notes than it should');
  };

  // A die per person, seeded: the same sequence of edits next time, so a failure
  // can be replayed. Each person's choices are their own and do not depend on how
  // the rounds happened to interleave.
  const dice = people.map((_, index) => createRandom(20260917 + index));
  const word = (random: () => number, round: number): string =>
    Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(random() * 6))).join('') +
    String(round);

  const roundEnds = Date.now() + SOAK_MS;
  const trace = process.env['SOAK_TRACE'] === '1';
  let round = 0;

  while (Date.now() < roundEnds) {
    round += 1;
    const actsStartedAt = Date.now();

    // Everybody acts at once, each from their own seeded choice: a new note, a
    // note moved, a note typed into, a note recoloured.
    await Promise.all(
      people.map(async (person, index) => {
        const mine = ownNotes[index];
        const random = dice[index];
        if (!mine || !random) throw new Error(`no dice or notes for ${person.name}`);
        const roll = random();
        const spare = Math.floor(random() * Math.max(1, mine.length));

        if (roll < 0.35 || mine.length === 0) {
          // Room is made before a note is taken: the last one this person made
          // goes, so the note that comes next has somewhere to be put.
          if (mine.length >= SOAK_NOTES_PER_PERSON) {
            const oldest = mine.shift();
            if (oldest) {
              await deleteNote(person, oldest);
              drift.delete(oldest);
              slotOf.delete(oldest);
            }
          }
          const slot = freeSlot(mine);
          const id = await createNote(
            person,
            SLOT_X[slot % SLOT_X.length] as number,
            SLOT_Y[Math.floor(slot / SLOT_X.length)] as number,
            word(random, round),
          );
          await stopEditing(person);
          mine.push(id);
          slotOf.set(id, slot);
          return;
        }

        const id = mine[spare] ?? mine[0];
        if (!id) return;

        if (roll < 0.65) {
          const dx = Math.round(random() * 100) - 50;
          const dy = Math.round(random() * 100) - 50;
          const soFar = drift.get(id) ?? { x: 0, y: 0 };
          // Turn back before reaching another note's space, so the notes of one
          // screen never end up on top of each other.
          const sign =
            Math.abs(soFar.x + dx) > SOAK_DRIFT_LIMIT || Math.abs(soFar.y + dy) > SOAK_DRIFT_LIMIT
              ? -1
              : 1;
          await dragNote(person, id, dx * sign, dy * sign);
          drift.set(id, { x: soFar.x + dx * sign, y: soFar.y + dy * sign });
          return;
        }

        if (roll < 0.85) {
          await startEditing(person, id);
          await type(person, word(random, round));
          await stopEditing(person);
          return;
        }

        const colour = SWATCH_NAMES[Math.floor(random() * SWATCH_NAMES.length)] ?? 'Yellow';
        await recolour(person, id, colour);
      }),
    );

    const actsAt = Date.now();

    // Each change is timed to the next person in the ring: how long until their
    // screen shows what the writer's screen shows.
    await Promise.all(
      people.map(async (person, index) => {
        const other = people[(index + 1) % people.length] as Participant;
        const mine = ownNotes[index] ?? [];
        const id = mine[mine.length - 1];
        if (!id) return;

        const label = `${other.name} sees ${person.name}'s round ${String(round)}`;
        if (await person.note(id)) {
          await expectEventually(
            label,
            async () =>
              [await sharedFieldsOf(other, id), await sharedFieldsOf(person, id)] as const,
            {
              is: ([onTheirs, onOwn]) =>
                onTheirs !== undefined && JSON.stringify(onTheirs) === JSON.stringify(onOwn),
            },
          );
          return;
        }
        await expectEventually(
          `${label} (a deletion)`,
          async () =>
            [(await person.note(id)) === undefined, (await other.note(id)) === undefined] as const,
          { is: ([goneForWriter, goneForOther]) => goneForWriter && goneForOther },
        );
      }),
    );

    if (trace) {
      console.log(
        `[soak] round ${String(round)}: acts ${String(actsAt - actsStartedAt)}ms, probes ${String(
          Date.now() - actsAt,
        )}ms`,
      );
    }
  }

  // Everything that was done is on every screen, and every screen is the same.
  await expectEventually(
    'every screen agrees at the end of the soak',
    async () => new Set(await Promise.all(people.map((person) => person.snapshot()))).size,
    { is: (distinct) => distinct === 1 },
  );

  // The soak has to have actually done something for that to mean anything.
  expect(round, 'the soak never got past its first round').toBeGreaterThan(2);
  expect((await people[0]?.notes().then((notes) => notes.size)) ?? 0).toBeGreaterThan(0);
  expect(consoleErrorsOf(people)).toEqual([]);
});
