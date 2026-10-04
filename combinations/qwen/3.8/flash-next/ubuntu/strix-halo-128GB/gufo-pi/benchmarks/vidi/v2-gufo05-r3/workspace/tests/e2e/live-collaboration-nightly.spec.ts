/**
 * Nightly live-collaboration soak (task 9): TC-29, TC-30. Tagged `@nightly`, so
 * the functional `npm run test:e2e` skips them (`--grep-invert @nightly`) and
 * `npm run test:e2e:nightly` runs only these.
 *
 * Durations follow the design (45 s idle, 60 s of continuous edits at capacity)
 * and stretch with NIGHTLY_IDLE_SECONDS / NIGHTLY_SOAK_SECONDS when someone asks
 * for a longer soak of the same code path.
 *
 * wrangler dev does not expose the Durable Object `hibernate` flag, so the
 * hibernation variant of TC-29 cannot be exercised here. What is covered is the
 * case the story cares about: a board nobody touches keeps its connections up,
 * with only the provider's keepalive on the wire.
 */
import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import type { StickyColor } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { STICKY_COLORS } from '../../src/shared/config';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  badgeText,
  boardKey,
  boardOf,
  closeParticipants,
  connectionLog,
  createBoard,
  expectEventually,
  latencySamplesSnapshot,
  openParticipants,
  type Participant,
} from './helpers/participants';
import {
  boxOf,
  centredCamera,
  dragBy,
  editor,
  note,
  noteById,
  notes,
  stopEditing,
} from './helpers/sticky-notes';
import { setCamera } from './helpers/board';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** How long two tabs sit with nobody touching them. */
const IDLE_MS = Number(process.env.NIGHTLY_IDLE_SECONDS ?? 45) * SECOND;
/** How long the capacity soak keeps editing. */
const SOAK_MS = Number(process.env.NIGHTLY_SOAK_SECONDS ?? 60) * SECOND;
/** y-websocket drops a connection it has heard nothing from for this long. */
const KEEPALIVE_DEADLINE_MS = 30_000;
/**
 * Zoom the soak works at. Notes are 200 world units, so at this zoom a note is
 * 50 screen pixels and the colour toolbar that appears above a selected note
 * (which keeps a constant screen size) still has clear air around it.
 */
const SOAK_ZOOM = 0.25;
/** How far each soak drag travels, in screen pixels: well past the point where
 * the app stops treating a press as a click, and short enough to keep notes in
 * their own patch of screen. */
const DRAG_STEP_PX = 15;
/** Notes per person during the soak; each one has its own spot on screen. */
const SOAK_SLOTS = 3;
/** Reproducible edit sequence; printed so a failure can be replayed. */
const SOAK_SEED = Number(process.env.NIGHTLY_SEED ?? 20260709);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** mulberry32: a tiny deterministic generator, so a soak run can be replayed. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rough memory of the local dev server, for the soak report. */
function devServerMemory(): string {
  try {
    const out = execSync(
      "ps -eo rss,comm | grep -E 'workerd|node' | awk '{s+=$1} END {print s}'",
      { encoding: 'utf8' },
    );
    const kb = Number(out.trim());
    return Number.isFinite(kb) ? `${Math.round(kb / 1024)}MB rss (node+workerd)` : 'unknown';
  } catch {
    return 'unknown';
  }
}

function requireLink(participant: Participant) {
  if (!participant.link) throw new Error(`${participant.name} needs controllableLink`);
  return participant.link;
}

/** Largest gap between consecutive frames seen on a connection. */
function largestGap(times: number[]): number {
  let max = 0;
  for (let i = 1; i < times.length; i += 1) max = Math.max(max, times[i]! - times[i - 1]!);
  return max;
}

async function writeText(participant: Participant, text: string, replace: boolean): Promise<void> {
  await editor(participant.page).focus();
  if (replace) await participant.page.keyboard.press('Control+a');
  await participant.page.keyboard.type(text, { delay: 5 });
  await stopEditing(participant.page);
}

/**
 * Like `expectEventually`, but prints what was actually seen when the change
 * never arrived: a soak that fails at minute nine is only debuggable with the
 * numbers from the moment it stopped converging.
 */
async function converge<T>(
  label: string,
  probe: () => Promise<T>,
  satisfied: (value: T) => boolean,
  evidence: (value: T) => string,
): Promise<void> {
  let last: T | undefined;
  try {
    await expectEventually(label, async () => ((last = await probe()), last), satisfied);
  } catch (error) {
    console.log(`[soak] ${label}: never converged; ${evidence(last as T)}`);
    throw error;
  }
}

/** Percentiles of a latency list, for the report line. */
function percentiles(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}

test.describe('@nightly live collaboration soak', () => {
  test('TC-29 two idle tabs stay connected for the whole idle period', async ({
    browser,
    request,
  }) => {
    test.setTimeout(IDLE_MS + 5 * MINUTE);
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam'], {
      controllableLink: true,
    });
    const participants = [alex, sam];
    const links = participants.map(requireLink);
    try {
      // Something on the board to prove it survives the quiet period.
      await alex.page.mouse.dblclick(350, 220);
      await writeText(alex, 'anchor note', false);
      await expectEventually('TC-29 anchor note arrives', () => boardOf(sam), (b) => b.length === 1);

      const started = Date.now();
      const frameTimes: number[][] = participants.map(() => []);
      const seenBadgeTexts = new Set<string>();

      while (Date.now() - started < IDLE_MS) {
        await sleep(5_000);
        for (const [index, p] of participants.entries()) {
          seenBadgeTexts.add(await badgeText(p));
          const link = links[index]!;
          frameTimes[index]!.push(...link.takeFrameTimes());
          expect(link.closedAt(), `${p.name}: idle connection died`).toEqual([]);
        }
      }

      const elapsed = Math.round((Date.now() - started) / 1000);
      const gaps = participants.map((_, index) => largestGap(frameTimes[index]!));
      console.log(
        `[idle] ${elapsed}s with 2 connections: ${frameTimes.map((t) => t.length).join('/')} ` +
          `frames, largest quiet gap ${gaps.map((g) => `${g}ms`).join('/')} (watchdog ` +
          `${KEEPALIVE_DEADLINE_MS}ms), ${devServerMemory()}`,
      );

      // The badge never had anything to say: no reconnect, and no state change
      // beyond connecting → connected.
      expect([...seenBadgeTexts], 'badge must never show Reconnecting').toEqual(['']);
      for (const p of participants) {
        const states = (await connectionLog(p)).map((entry) => entry.state);
        expect([...new Set(states)], `${p.name}: connection state drift`).toEqual([
          'connecting',
          'connected',
        ]);
      }
      for (const [index, gap] of gaps.entries()) {
        expect(gap, `${participants[index]!.name}: keepalive inside the watchdog`).toBeLessThan(
          KEEPALIVE_DEADLINE_MS,
        );
      }

      // And the connection is a live one: a fresh edit still crosses in one hop.
      await alex.page.mouse.dblclick(900, 650);
      await writeText(alex, 'after idle', false);
      await expectEventually('TC-29 still live after idle', () => boardOf(sam), (b) =>
        b.some((n) => n.text === 'after idle'),
      );
      expect(boardKey(await boardOf(alex))).toBe(boardKey(await boardOf(sam)));
      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-30 a full room keeps up with continuous edits', async ({ browser, request }) => {
    test.setTimeout(SOAK_MS + 10 * MINUTE);
    const people = MAX_CONCURRENT_EDITORS;
    const participants = await openParticipants(
      browser,
      await createBoard(request),
      Array.from({ length: people }, (_, i) => `Editor${i + 1}`),
      { controllableLink: true },
    );

    // Each person owns a row of slots on their own screen. Everyone shares the
    // same camera, so a slot is the same screen point for everybody — and a note
    // is always found by its model id, never by remembered coordinates. Spacing
    // leaves room for a note body plus the toolbar above it, so nothing a person
    // reaches for is ever covered by the note next door.
    const home = (person: number, slot: number) => ({
      x: 240 + slot * 200,
      y: 100 + person * 140,
    });
    const desks: (string | undefined)[][] = participants.map(() =>
      Array<string | undefined>(SOAK_SLOTS).fill(undefined),
    );

    const random = makeRandom(SOAK_SEED);
    const pick = <T,>(items: T[]): T | undefined =>
      items.length === 0 ? undefined : items[Math.floor(random() * items.length)]!;
    const centre = async (p: Participant, id: string) => {
      const box = await boxOf(noteById(p.page, id));
      return { x: box.cx, y: box.cy };
    };

    try {
      for (const p of participants) await setCamera(p.page, centredCamera(SOAK_ZOOM));

      let changes = 0;
      const started = Date.now();
      while (Date.now() - started < SOAK_MS) {
        const person = Math.floor(random() * people);
        const author = participants[person]!;
        const others = participants.filter((_, index) => index !== person);
        const desk = desks[person]!;
        const empties = desk
          .map((id, index) => (id === undefined ? index : -1))
          .filter((index) => index >= 0);
        const owned = desk.filter((id): id is string => id !== undefined);
        const everyOther = (label: string, satisfied: (boards: StickySnapshot[][]) => boolean) =>
          expectEventually(
            `${author.name} ${label}`,
            () => Promise.all(others.map((p) => boardOf(p))),
            satisfied,
          );

        const actions: (() => Promise<void>)[] = [];
        if (empties.length > 0) {
          actions.push(async () => {
            const slotIndex = pick(empties)!;
            const at = home(person, slotIndex);
            const before = new Set((await boardOf(author)).map((n) => n.id));
            await author.page.mouse.dblclick(at.x, at.y);
            await editor(author.page).waitFor({ state: 'visible' });
            await writeText(author, `${author.name}-${changes}`, false);
            const created = (await boardOf(author)).find((n) => !before.has(n.id));
            if (!created) throw new Error(`${author.name}: note did not appear on its author`);
            desk[slotIndex] = created.id;
            await everyOther('created a note', (boards) =>
              boards.every((b) => b.some((n) => n.id === created.id)),
            );
            changes += 1;
          });
        }
        if (owned.length > 0) {
          actions.push(async () => {
            const id = pick(owned)!;
            const worldBefore = (await boardOf(author)).find((n) => n.id === id);
            if (!worldBefore) throw new Error(`${author.name}: note ${id} vanished`);
            const slotIndex = desk.indexOf(id);
            const from = await centre(author, id);
            // A press has to travel past DRAG_THRESHOLD_PX to become a drag, so
            // always aim a real distance away: back toward the slot's home, or
            // away from it when the note already sits there. That keeps every
            // note inside its own patch of screen however long the soak runs.
            const homeAt = home(person, slotIndex);
            const dx = homeAt.x - from.x;
            const dy = homeAt.y - from.y;
            const distance = Math.hypot(dx, dy);
            const unit =
              distance > 0.5 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
            const sign = distance <= 10 ? -1 : 1;
            const to = {
              x: Math.round(from.x + sign * unit.x * DRAG_STEP_PX),
              y: Math.round(from.y + sign * unit.y * DRAG_STEP_PX),
            };
            await dragBy(author.page, from, to.x - from.x, to.y - from.y);
            // The soak checks that a move reaches everybody, not the arithmetic
            // of where it lands: the pointer can stop a frame short of its
            // target (story 2 covers drag precision), so the check is that every
            // board agrees on one settled position, that the note really moved,
            // and that it ended up where the author aimed within a few pixels.
            const target = {
              x: worldBefore.x + (to.x - from.x) / SOAK_ZOOM,
              y: worldBefore.y + (to.y - from.y) / SOAK_ZOOM,
            };
            const aim = 12 / SOAK_ZOOM;
            await converge(
              `${author.name} moved a note`,
              () => Promise.all([boardOf(author), ...others.map((p) => boardOf(p))]),
              (boards) => {
                const spots = boards.map((b) => {
                  const n = b.find((note) => note.id === id);
                  return n ? `${n.x.toFixed(2)},${n.y.toFixed(2)}` : undefined;
                });
                const settled = spots[0];
                if (!settled || !spots.every((spot) => spot === settled)) return false;
                const [x, y] = settled.split(',').map(Number) as [number, number];
                const moved = Math.hypot(x - worldBefore.x, y - worldBefore.y);
                const onTarget = Math.hypot(x - target.x, y - target.y);
                return moved > 1 && onTarget < aim;
              },
              (boards) =>
                `aimed at (${target.x.toFixed(1)}, ${target.y.toFixed(1)}), saw ` +
                boards
                  .map((b) => {
                    const n = b.find((note) => note.id === id);
                    return n ? `(${n.x.toFixed(1)}, ${n.y.toFixed(1)})` : 'missing';
                  })
                  .join(' '),
            );
            changes += 1;
          });
          actions.push(async () => {
            const id = pick(owned)!;
            const text = `${author.name} says ${Math.floor(random() * 1000)}`;
            await noteById(author.page, id).dblclick();
            await editor(author.page).waitFor({ state: 'visible' });
            await writeText(author, text, true);
            await everyOther('typed text', (boards) =>
              boards.every((b) => b.find((n) => n.id === id)?.text === text),
            );
            changes += 1;
          });
          actions.push(async () => {
            const id = pick(owned)!;
            const color = pick(Object.keys(STICKY_COLORS) as StickyColor[])!;
            await noteById(author.page, id).click();
            await author.page.getByRole('button', { name: `${color} colour` }).click();
            await everyOther('recoloured a note', (boards) =>
              boards.every((b) => b.find((n) => n.id === id)?.color === color),
            );
            changes += 1;
          });
          actions.push(async () => {
            const id = pick(owned)!;
            await noteById(author.page, id).click();
            await author.page.keyboard.press('Delete');
            await everyOther('deleted a note', (boards) => boards.every((b) => !b.some((n) => n.id === id)));
            desk[desk.indexOf(id)] = undefined;
            changes += 1;
          });
        }

        await pick(actions)!();
      }

      // Everyone ends on the same board, and every note still on it is where the
      // person who moved it last left it.
      const expectedNotes = desks.flat().filter((slot) => slot !== undefined).length;
      await expectEventually(
        'TC-30 final boards identical',
        () => Promise.all(participants.map((p) => boardOf(p))),
        (boards) => boards.every((b) => boardKey(b) === boardKey(boards[0])),
      );
      for (const p of participants) {
        await expect(notes(p.page)).toHaveCount(expectedNotes);
        await expect(note(p.page, 0)).toBeVisible();
      }

      const measured = latencySamplesSnapshot().filter((s) =>
        participants.some((p) => s.label.startsWith(p.name)),
      );
      const { p50, p95, max } = percentiles(measured.map((s) => s.ms));
      console.log(
        `[soak] seed ${SOAK_SEED}: ${people} connections, ${changes} changes over ` +
          `${Math.round((Date.now() - started) / 1000)}s, ${expectedNotes} notes left on the ` +
          `board: author-to-every-other propagation p50=${p50}ms p95=${p95}ms max=${max}ms ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms), ${devServerMemory()}`,
      );

      expect(participants.flatMap((p) => p.consoleErrors)).toEqual([]);
    } finally {
      // Teardown side effect: closing a context tears the transport down, and a
      // tab that is gone must not start dialling again.
      const socketsBefore = new Map(
        participants.map((p) => [p.name, requireLink(p).routes.length] as const),
      );
      await closeParticipants(participants);
      await sleep(5_000);
      const reconnected = participants.filter(
        (p) => requireLink(p).routes.length > (socketsBefore.get(p.name) ?? 0),
      );
      expect(reconnected.map((p) => p.name), 'a closed tab must not reconnect').toEqual([]);
    }
  });
});
