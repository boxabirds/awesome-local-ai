/**
 * The nightly run: the two things that take longer than a test suite should.
 *
 * Both tests compress time with `NIGHTLY_SHORT=1` so they can be checked in a few
 * seconds while working on them; the nightly job runs them at full length, because
 * the question they answer — does a board still work after forty-five minutes of
 * nothing, does a board at its design capacity hold for an hour — is not a question
 * a fast test can answer.
 *
 * Latency is recorded and printed, never asserted (prd §Testing): a slow run of
 * this suite is a fact about a machine also running five browsers, the app, the
 * Worker and the model. What fails the run is a change that never arrives, a board
 * that drifts apart, or a connection that does not come back.
 *
 * TC-29 an idle board stays connected, and is still live afterwards
 * TC-30 an hour at the design capacity, measured
 */
import { expect, test } from '@playwright/test';

import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NIGHTLY_CAPACITY_MINUTES,
  NIGHTLY_REJOIN_EVERY_MINUTES,
  NIGHTLY_REJOIN_WINDOW_MINUTES,
  NIGHTLY_SHORT_SCALE,
  NIGHTLY_STABILITY_MINUTES,
} from '../../src/shared/config';
// The same seeded generator the document-level soak uses (integration, task 6), so
// both runs edit a board the same way — only this one does it through the real UI.
import { createRng } from '../integration/fixtures/random-ops';
import {
  noteWorld,
  openBoard,
  placeNote,
  type BoardSession,
  type Participant,
} from './helpers/participants';
import {
  applyRandomOp,
  NOTES_EACH,
  SEED,
  shapeOf,
  SOAK_SPACING,
  type OwnedNote,
  type OwnedNotes,
} from './helpers/soak';

/**
 * `NIGHTLY_SHORT=1` shrinks every minute to a second. Off by default: the nightly
 * job is what runs this file, and it should run it for real.
 */
const COMPRESS = process.env.NIGHTLY_SHORT === undefined ? 1 : NIGHTLY_SHORT_SCALE;

/** A minute of the story, in milliseconds of this run. */
const minute = (minutes: number): number => Math.round((minutes * 60_000) / COMPRESS);

const STABILITY_MS = minute(NIGHTLY_STABILITY_MINUTES);
const CAPACITY_MS = minute(NIGHTLY_CAPACITY_MINUTES);
/** How often a person drops and comes back during the capacity run's opening. */
const REJOIN_EVERY_MS = minute(NIGHTLY_REJOIN_EVERY_MINUTES);
/** How often the capacity run makes a change and measures the trip. */
const CYCLE_MS = COMPRESS === 1 ? 2_000 : 200;
/** A progress line, so a long run says something while it goes. */
const PROGRESS_MS = minute(1);

/** How long a person stays away when they drop out of the capacity run. */
const OUTAGE_MS = Math.max(500, Math.min(3_000, REJOIN_EVERY_MS / 4));

const scaleNote = COMPRESS === 1 ? '' : ` (compressed ${String(COMPRESS)}x by NIGHTLY_SHORT)`;

/** One person's latency record for a whole run. */
class Trip {
  private readonly samples: number[] = [];
  private readonly misses: string[] = [];

  constructor(private readonly budget: number) {}

  /**
   * Time how long `check` takes to hold. Returns null when it never did within the
   * budget: that is a failure, but it is collected rather than thrown, so one bad
   * minute in an hour does not hide the rest of the hour.
   */
  async measure(
    label: string,
    check: () => Promise<boolean>,
    diagnose?: () => Promise<string>,
  ): Promise<void> {
    const started = Date.now();
    try {
      await expect
        .poll(check, { timeout: Math.max(15_000, this.budget * 3), intervals: [50, 100, 250] })
        .toBe(true);
      this.samples.push(Date.now() - started);
    } catch {
      this.misses.push(label);
      // A soak that silently drops one divergence is a soak that tells you nothing
      // about it afterwards, so the boards involved go in the log.
      const detail = diagnose
        ? `\n  ${(await diagnose().catch(() => 'nothing further')).slice(0, 1_500)}`
        : '';
      console.log(`[nightly] MISS ${label}${detail}`);
    }
  }

  report(title: string): void {
    const sorted = [...this.samples].sort((left, right) => left - right);
    const at = (fraction: number): number =>
      sorted.length === 0
        ? 0
        : (sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0);
    console.log(
      `[nightly] ${title}: ${String(sorted.length)} measured changes` +
        (sorted.length === 0
          ? ''
          : `, p50 ${String(at(0.5))} ms, p95 ${String(at(0.95))} ms, max ${String(at(1))} ms`) +
        `, budget ${String(this.budget)} ms (reported, not asserted)`,
    );
    if (this.misses.length > 0) {
      console.log(
        `[nightly] ${title}: ${String(this.misses.length)} changes never arrived: ` +
          `${this.misses.slice(0, 10).join('; ')}`,
      );
    }
  }

  get failed(): readonly string[] {
    return this.misses;
  }

  get count(): number {
    return this.samples.length;
  }
}

async function closeAll(session: BoardSession): Promise<void> {
  await session.close();
}

test.describe.configure({ mode: 'serial' });

test.describe('nightly', () => {
  test(`TC-29 a board left alone for ${String(NIGHTLY_STABILITY_MINUTES)} minutes stays connected`, async ({
    browser,
  }) => {
    test.setTimeout(STABILITY_MS + 5 * 60_000);
    const seconds = String(Math.round(STABILITY_MS / 1000));
    console.log(`[nightly] TC-29 holding an idle board for ${seconds} s${scaleNote}`);

    const session = await openBoard(browser, 2);
    try {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');

      // One change each, so there is something on the board and something to compare.
      const alexId = await alex.createNote({ x: 300, y: 300 });
      const samId = await sam.createNote({ x: 700, y: 400 });
      await expect
        .poll(async () => (await alex.note(samId)) !== undefined && (await sam.note(alexId)) !== undefined, {
          timeout: 30_000,
        })
        .toBe(true);

      const started = Date.now();
      let checks = 0;
      while (Date.now() - started < STABILITY_MS) {
        await alex.page.waitForTimeout(Math.min(PROGRESS_MS, 60_000));
        checks += 1;
        // Nothing has been done to the board in between, so agreement here is the
        // whole of the claim: no drift, and no socket quietly gone.
        const [alexShape, samShape] = await shapeOf([alex, sam]);
        const [alexState, samState] = await Promise.all([alex.connectionState(), sam.connectionState()]);
        console.log(
          `[nightly] TC-29 ${String(Math.round((Date.now() - started) / 1000))} s in: ` +
            `${String((await alex.board()).length)} notes, Alex ${alexState}, Sam ${samState}, ` +
            `boards ${alexShape === samShape ? 'agree' : 'HAVE DRIFTED'}`,
        );
        expect(
          alexShape,
          `the boards drifted apart while nobody was using them (check ${String(checks)})`,
        ).toBe(samShape);
        // Both still think they are connected: the room keeps a quiet socket open,
        // and nothing has decided to start reconnecting on its own.
        expect(['connected', 'confirmed'].includes(await alex.connectionState())).toBe(true);
        expect(['connected', 'confirmed'].includes(await sam.connectionState())).toBe(true);
      }

      // The claim is not that nothing broke. It is that the board still works.
      const trip = new Trip(LIVE_UPDATE_LATENCY_BUDGET_MS);
      const fresh = await alex.createNote({ x: 500, y: 600 });
      await trip.measure('a note made after the idle period reaches the other person', async () =>
        (await sam.note(fresh)) !== undefined,
      );
      await alex.dragNote(fresh, { x: 60, y: -40 });
      await trip.measure('and a drag of it reaches them too', async () => {
        const [mine, theirs] = await Promise.all([alex.note(fresh), sam.note(fresh)]);
        return !!mine && !!theirs && mine.x === theirs.x && mine.y === theirs.y;
      });
      trip.report('TC-29 after the idle period');

      expect(trip.failed, 'everything made after the idle period arrived').toEqual([]);
      const [alexShape, samShape] = await shapeOf([alex, sam]);
      expect(samShape, 'the boards still agree at the end').toBe(alexShape);
      expect([...alex.errors(), ...sam.errors()], 'nothing went wrong on either screen').toEqual([]);
    } finally {
      await closeAll(session);
    }
  });

  test(`TC-30 ${String(MAX_CONCURRENT_EDITORS)} people for ${String(NIGHTLY_CAPACITY_MINUTES)} minutes`, async ({
    browser,
  }) => {
    test.setTimeout(CAPACITY_MS + 10 * 60_000);
    console.log(
      `[nightly] TC-30 capacity ${String(MAX_CONCURRENT_EDITORS)} (the design's number, from config), ` +
        `${String(Math.round(CAPACITY_MS / 1000))} s${scaleNote}`,
    );

    const session = await openBoard(browser, MAX_CONCURRENT_EDITORS);
    try {
      const people = session.participants;
      const trip = new Trip(LIVE_UPDATE_LATENCY_BUDGET_MS);
      const rng = createRng(SEED);
      console.log(`[nightly] TC-30 seed ${String(SEED)} (a run can be replayed from it)`);

      // Whose notes are whose. A person only ever acts on notes they made, and each
      // note remembers where it belongs, so a click can only be a click on the note
      // it means however much the board has been pushed about.
      const own = new Map<string, OwnedNotes>();
      for (const [index, person] of people.entries()) {
        const notes: OwnedNote[] = [];
        for (let slot = 0; slot < NOTES_EACH; slot += 1) {
          const home = noteWorld(index, slot, SOAK_SPACING);
          notes.push({ id: await placeNote(person, home), home });
        }
        own.set(person.name, { notes, nextSlot: NOTES_EACH });
      }
      await expect
        .poll(
          async () => {
            const sizes = await Promise.all(people.map(async (person) => (await person.noteIds()).length));
            return sizes.every((size) => size === people.length * NOTES_EACH);
          },
          { timeout: 60_000 },
        )
        .toBe(true);

      const started = Date.now();
      let rounds = 0;
      let rejoins = 0;
      let nextRejoin = started + REJOIN_EVERY_MS;
      let nextProgress = started + PROGRESS_MS;

      while (Date.now() - started < CAPACITY_MS) {
        // A person drops and comes back on the clock, for the first ten minutes:
        // joining is part of what a session has to survive, not only staying.
        if (
          Date.now() - started < minute(NIGHTLY_REJOIN_WINDOW_MINUTES) &&
          Date.now() >= nextRejoin
        ) {
          const joiner = people[rejoins % people.length] as Participant;
          await joiner.goOffline();
          // That it really dropped is part of the test: a re-join that never left is
          // not a re-join.
          await expect
            .poll(() => joiner.connectionState(), {
              timeout: 20_000,
              message: `${joiner.name} did not notice being disconnected`,
            })
            .not.toBe('confirmed');
          await joiner.page.waitForTimeout(OUTAGE_MS);
          await joiner.goOnline();
          await expect
            .poll(() => joiner.connectionState(), { timeout: 30_000 })
            .toBe('confirmed');
          rejoins += 1;
          nextRejoin += REJOIN_EVERY_MS;
          console.log(`[nightly] TC-30 ${joiner.name} rejoined (${String(rejoins)} in total)`);
        }

        // One round: every person makes one seeded edit of their own notes, and
        // every other person's board has to become the same board before the next
        // round. Convergence, not position, is the thing being checked — which is
        // why the check is the whole board and not one note.
        rounds += 1;
        for (const [index, person] of people.entries()) {
          const notes = own.get(person.name) as OwnedNotes;
          const description = await applyRandomOp(person, notes, rng, index);
          const actor = person;
          for (const watcher of people.filter((candidate) => candidate !== actor)) {
            await trip.measure(
              `${watcher.name} did not see ${actor.name}'s ${description} in round ${String(rounds)}`,
              async () => {
                const [from, to] = await shapeOf([actor, watcher]);
                return from === to;
              },
              async () => {
                const [from, to] = await shapeOf([actor, watcher]);
                return `${actor.name}: ${from}\n  ${watcher.name}: ${to}`;
              },
            );
          }
        }

        if (Date.now() >= nextProgress) {
          const shapes = await shapeOf(people);
          console.log(
            `[nightly] TC-30 ${String(Math.round((Date.now() - started) / 1000))} s in: ` +
              `${String(rounds)} rounds, ${String(trip.count)} measured, ` +
              `boards ${new Set(shapes).size === 1 ? 'agree' : 'HAVE DRIFTED'}`,
          );
          expect(new Set(shapes).size, 'every screen holds the same board mid-run').toBe(1);
          nextProgress += PROGRESS_MS;
        }

        await people[0]!.page.waitForTimeout(CYCLE_MS);
      }

      trip.report(`TC-30 ${String(MAX_CONCURRENT_EDITORS)} people, ${String(rounds)} rounds`);
      expect(trip.failed, 'every change made during the run arrived').toEqual([]);

      // The end state: one board, on every screen.
      const shapes = await shapeOf(people);
      expect(new Set(shapes).size, 'the boards agree at the end of the run').toBe(1);
      expect(people.flatMap((person) => person.errors()), 'nothing went wrong on any screen').toEqual([]);
      console.log(
        `[nightly] TC-30 finished: ${String(rounds)} rounds, ${String(rejoins)} rejoins, ` +
          `${String(Math.round((Date.now() - started) / 1000))} s elapsed`,
      );
    } finally {
      await closeAll(session);
    }
  });
});
