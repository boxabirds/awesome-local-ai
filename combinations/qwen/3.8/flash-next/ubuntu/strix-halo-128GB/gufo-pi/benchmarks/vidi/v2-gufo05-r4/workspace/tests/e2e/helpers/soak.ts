/**
 * Soak helpers: what a person does at the board, and how long it takes to show.
 *
 * The nightly tests run for minutes, so everything here is written to be
 * reproducible (choices from a seeded generator, an op log printed with the seed)
 * and to keep the boards comparable as data (`boardOf` reads the document, not the
 * screen). Latency is *measured and printed*; the pass/fail signal is convergence,
 * because wall-clock time on a machine sharing itself between browsers, a model and
 * a server is not a reliable one.
 */

import { expect, type Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import { screenToWorld, worldToScreen, type Camera } from '../../../src/client/canvas/camera';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../../src/shared/config';
import { deleteButton, doubleClickBoard, dragNote, getCamera, note, swatch } from './board';
import { boardOf } from './participants';
import { below } from '../../helpers/random';

/** The colours a note can be, read off the named settings. */
const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Words to type: long enough that typing takes a few keystrokes, as it does for real. */
const WORDS = [
  'pricing',
  'workflow',
  'onboarding',
  'customer call',
  'follow-up',
  'timeline',
  'budget',
  'research',
  'decision',
  'handoff',
  'roadmap',
  'blocker'
];

/**
 * Where notes may be made, in screen points, spaced further apart than a note is
 * wide so a double-click always lands on empty board.
 */
const SLOTS = [
  { x: 250, y: 180 },
  { x: 510, y: 180 },
  { x: 770, y: 180 },
  { x: 1030, y: 180 },
  { x: 250, y: 440 },
  { x: 510, y: 440 },
  { x: 770, y: 440 },
  { x: 1030, y: 440 }
];

/** How far a note may drift from the slot it was made in, in world units. */
const DRIFT = 70;

/** A point on the board with nothing on it, used to end an edit or a selection. */
const QUIET = { x: 140, y: 700 };

/** One thing a soak did, with how long it took to reach everybody else. */
export interface SoakOp {
  readonly what: string;
  readonly ms: number;
}

/** A word, chosen by the run's generator. */
function word(random: () => number): string {
  return WORDS[below(random, WORDS.length)];
}

/** Whether a note lies under this person's eyes, and so can be clicked at all. */
function onScreen(
  camera: Camera,
  noteHeld: StickySnapshot,
  viewport: { width: number; height: number }
): boolean {
  const centre = worldToScreen(camera, {
    x: noteHeld.x + STICKY_SIZE_WORLD / 2,
    y: noteHeld.y + STICKY_SIZE_WORLD / 2
  });
  return (
    centre.x > 30 &&
    centre.y > 30 &&
    centre.x < viewport.width - 30 &&
    centre.y < viewport.height - 30
  );
}

/** Make a note in a slot that nothing occupies yet, and say where. */
async function createNote(
  page: Page,
  random: () => number,
  held: StickySnapshot[]
): Promise<{ description: string; slot?: { x: number; y: number } }> {
  const camera = await getCamera(page);
  // Slots are tried in a rotation rather than a shuffle: with a random comparator a
  // sort is implementation-dependent, and a seed is only worth printing if replaying
  // it goes the same way twice.
  const first = below(random, SLOTS.length);
  for (let step = 0; step < SLOTS.length; step += 1) {
    const choice = (first + step) % SLOTS.length;
    // The slot is a screen point; its place in the world depends on where this
    // person is looking, which is how each of them ends up in their own corner.
    const slot = screenToWorld(camera, SLOTS[choice]);
    const occupied = held.some(
      (noteHeld) => Math.abs(noteHeld.x - slot.x) < DRIFT * 2 && Math.abs(noteHeld.y - slot.y) < DRIFT * 2
    );
    if (occupied) continue;
    await doubleClickBoard(page, SLOTS[choice].x, SLOTS[choice].y);
    await page.keyboard.type(word(random));
    await page.mouse.click(QUIET.x, QUIET.y);
    return { description: `created at (${Math.round(slot.x)}, ${Math.round(slot.y)})`, slot };
  }
  return { description: 'found no free slot' };
}

/**
 * Do one random thing through the real interface — create, type, move, recolour or
 * delete, in the proportions the design asks for — and describe it.
 *
 * `slots` remembers which slot each note belongs to so a move stays near home:
 * notes that drifted together would start covering one another, and a click meant
 * for one note would land on another.
 */
export async function randomEdit(
  page: Page,
  random: () => number,
  slots: Map<string, { x: number; y: number }>
): Promise<string> {
  const held = (await boardOf(page)) as StickySnapshot[];
  const roll = random();

  if (held.length === 0 || roll < 0.1) {
    const made = await createNote(page, random, held);
    if (made.slot) {
      // The new note is the one that was not there before.
      const after = (await boardOf(page)) as StickySnapshot[];
      const fresh = after.find((candidate) => !held.some((before) => before.id === candidate.id));
      if (fresh) slots.set(fresh.id, made.slot);
    }
    return made.description;
  }

  // Everybody shares one board, so most of it is off this person's screen. Only what
  // they can see is something they could be doing something to.
  const camera = await getCamera(page);
  const viewport = await page.viewportSize();
  const reachable = held
    .map((noteHeld, index) => ({ noteHeld, index }))
    .filter(({ noteHeld }) => onScreen(camera, noteHeld, viewport ?? { width: 1280, height: 720 }));
  if (reachable.length === 0) return 'found nothing in reach to change';

  const index = reachable[below(random, reachable.length)].index;
  const target = held[index];

  if (roll < 0.5) {
    await note(page, index).click();
    await page.keyboard.press('Enter');
    await page.keyboard.type(` ${word(random)}`);
    await page.mouse.click(QUIET.x, QUIET.y);
    return `typed in ${target.id}`;
  }

  if (roll < 0.8) {
    const slot = slots.get(target.id) ?? { x: target.x, y: target.y };
    const to = {
      x: slot.x + (random() * 2 - 1) * DRIFT,
      y: slot.y + (random() * 2 - 1) * DRIFT
    };
    slots.set(target.id, slot);
    await dragNote(page, index, to.x - target.x, to.y - target.y);
    return `moved ${target.id} to (${Math.round(to.x)}, ${Math.round(to.y)})`;
  }

  if (roll < 0.9) {
    const colour = COLOURS[below(random, COLOURS.length)];
    await note(page, index).click();
    await swatch(page, colour, index).click();
    return `recoloured ${target.id} ${colour}`;
  }

  await note(page, index).click();
  await deleteButton(page, index).click();
  slots.delete(target.id);
  return `deleted ${target.id}`;
}

/**
 * Wait until every other board holds exactly what `sender` holds, and report how
 * long that took. A change that never arrives is a failure; a change that arrives
 * slowly is a number in the report.
 */
export async function waitForEveryone(
  what: string,
  sender: Page,
  others: { name: string; page: Page }[],
  timeoutMs: number
): Promise<number> {
  const target = JSON.stringify(await boardOf(sender));
  const started = Date.now();
  for (const other of others) {
    await expect
      .poll(async () => JSON.stringify(await boardOf(other.page)), {
        timeout: timeoutMs,
        message: `${what} never reached ${other.name}`
      })
      .toBe(target);
  }
  return Date.now() - started;
}

/** The middle, the tail and the worst of a set of measurements. */
export function percentiles(samples: readonly number[]): { p50: number; p95: number; max: number } {
  if (samples.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

/** Print the soak: the seed to replay it with, then the latency numbers. */
export function reportSoak(
  seed: number,
  ops: readonly SoakOp[],
  budgetMs: number,
  header: string
): void {
  const { p50, p95, max } = percentiles(ops.map((op) => op.ms));
  const slowest = [...ops].sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(
    [
      `  ${header}: ${ops.length} change(s), seed ${seed}`,
      `  propagation p50 ${p50}ms  p95 ${p95}ms  max ${max}ms  (budget ${budgetMs}ms, reported not asserted)`,
      ...slowest.map((op) => `    ${op.ms}ms  ${op.what}`),
      ops.some((op) => op.ms > budgetMs)
        ? `  ${ops.filter((op) => op.ms > budgetMs).length} change(s) took longer than the budget`
        : '  every change arrived inside the budget'
    ].join('\n')
  );
}

/* ------------------------------------------------------- watching an idle connection */

/** One reading of a page's connection, taken inside the page. */
export interface ConnectionReading {
  readonly at: number;
  readonly state: string | null;
  readonly badge: string | null;
}

/**
 * Start sampling the connection inside the page, every quarter second.
 *
 * Sampling there rather than from the test driver means a momentary slip cannot
 * happen between two reads and go unnoticed.
 */
export async function startConnectionWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const readings: { at: number; state: string | null; badge: string | null }[] = [];
    const started = Date.now();
    const read = () =>
      readings.push({
        at: Date.now() - started,
        state: window.__vidi6?.connectionState ?? null,
        badge: document.querySelector('[data-vidi6="connection-status"]')?.textContent ?? null
      });
    read();
    const watch = { readings, timer: window.setInterval(read, 250) };
    (window as unknown as { __connectionWatch: unknown }).__connectionWatch = watch;
  });
}

/** Stop sampling and hand back every reading taken. */
export async function stopConnectionWatch(page: Page): Promise<ConnectionReading[]> {
  return page.evaluate(() => {
    const holder = window as unknown as {
      __connectionWatch?: { readings: ConnectionReading[]; timer: number };
    };
    const watch = holder.__connectionWatch;
    if (!watch) throw new Error('the connection was never watched');
    window.clearInterval(watch.timer);
    return watch.readings;
  });
}
