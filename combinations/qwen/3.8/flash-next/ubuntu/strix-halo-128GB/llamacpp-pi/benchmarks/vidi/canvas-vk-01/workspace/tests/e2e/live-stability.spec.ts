import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../src/shared/config';
import {
  appendToNote,
  colourNote,
  connectionBadge,
  connectionState,
  createNote,
  createNoteAt,
  deleteNote,
  dragNoteBy,
  joinBoard,
  noteBox,
  noteStates,
  notesOnScreen,
  ownsCentre,
  setCamera,
  socketCount,
  startBoard,
  waitForIdenticalBoards,
  waitForNotes,
  watchErrors,
} from './helpers/live';

/**
 * Nightly suite: long-running behaviour that is too slow for every commit.
 * Skipped unless `NIGHTLY=1` (`npm run test:e2e:nightly`), because it holds a
 * board open for an hour and opens one context per seat of the capacity
 * setting.
 *
 * - TC-29: an idle board stays connected (the room relays awareness, so
 *   y-websocket's idle timeout never fires) and still syncs afterwards.
 * - TC-30: a capacity soak of seeded random edits through the real UI, with the
 *   per-change latency measured for every one of them.
 */

/** The nightly budget: one hour idle, checked every 5 s. */
const IDLE_MINUTES = Number(process.env.NIGHTLY_IDLE_MINUTES ?? 60);
const IDLE_POLL_MS = 5_000;
/** How long the capacity soak keeps editing for, and what it started from. */
const SOAK_MS = Number(process.env.NIGHTLY_SOAK_MS ?? 60_000);
const SEED = Number(process.env.NIGHTLY_SEED ?? 20_260_815);
const VIEWPORT = { width: 1280, height: 800 };
/** Notes are 80px on screen at this camera, so a 110px grid never overlaps. */
const CAMERA = { x: 0, y: 0, zoom: 0.4 };
const GRID = 110;
const SLOTS = 4;

test.describe.configure({ timeout: (IDLE_MINUTES + 5) * 60_000 });

const nightly = process.env.NIGHTLY === '1' ? test : test.skip;

nightly('TC-29: an idle board stays connected for an hour and still syncs afterwards', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ viewport: VIEWPORT });
  const contextB = await browser.newContext({ viewport: VIEWPORT });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const errorsOnA = watchErrors(a);
  const errorsOnB = watchErrors(b);
  try {
    const boardId = await startBoard(a);
    await joinBoard(b, boardId);

    const deadline = Date.now() + IDLE_MINUTES * 60_000;
    while (Date.now() < deadline) {
      await a.waitForTimeout(IDLE_POLL_MS);
      // The connection is not dropped or reset while idle, and nothing is
      // logged: the room keeps its empty-socket contract quietly.
      expect(await connectionState(a)).toBe('connected');
      expect(await connectionState(b)).toBe('connected');
      expect(errorsOnA.errors()).toEqual([]);
      expect(errorsOnB.errors()).toEqual([]);
    }

    // After the idle hour the board still works.
    const id = await createNote(a);
    await waitForNotes(b, await notesOnScreen(a));
    await dragNoteBy(a, id, { x: 50, y: 50 });
    await waitForNotes(b, await notesOnScreen(a));
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

nightly('TC-30: five clients edit randomly for a minute and every change arrives in time', async ({
  browser,
}: {
  browser: Browser;
}) => {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: Array<{ errors(): string[] }> = [];
  try {
    for (let seat = 0; seat < MAX_CONCURRENT_EDITORS; seat += 1) {
      const context = await browser.newContext({ viewport: VIEWPORT });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      errors.push(watchErrors(page));
      if (seat === 0) await startBoard(page);
      else await joinBoard(page, boardIdOf(pages[0]));
      await setCamera(page, CAMERA);
    }

    const random = makeRandom(SEED);
    // Each seat owns one row of SLOTS note positions, so its notes never sit on
    // top of each other and every one of them can be grabbed.
    const slots: Array<Array<string | null>> = pages.map(() =>
      Array.from({ length: SLOTS }, () => null),
    );
    const latencies: number[] = [];

    const deadline = Date.now() + SOAK_MS;
    while (Date.now() < deadline) {
      for (const [seat, page] of pages.entries()) {
        const op = await randomEdit(page, seat, slots[seat], random);
        if (op === null) continue;
        // Measured from this client's own commit to every other client showing
        // the same board — the contract of story 3, per change.
        const elapsed = await waitForIdenticalBoards(pages);
        latencies.push(elapsed);
        expect(
          elapsed,
          `${op} on seat ${seat} took ${elapsed}ms to reach the others`,
        ).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);
        for (const other of pages) {
          expect(await connectionState(other)).toBe('connected');
        }
      }
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const percentile = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.log(
      `TC-30 seed=${SEED} changes=${sorted.length} ` +
        `p50=${percentile(0.5)}ms p95=${percentile(0.95)}ms max=${sorted.at(-1)}ms ` +
        `budget=${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`,
    );
    // "Continuous" edits, not one lap of the loop.
    expect(sorted.length).toBeGreaterThanOrEqual(50);

    // Every client ends on the same board, note for note, and nobody showed a
    // badge or an error while it happened.
    const finals = await Promise.all(pages.map(noteStates));
    for (const [seat, state] of finals.entries()) {
      expect(state, `seat ${seat} disagrees with seat 0`).toEqual(finals[0]);
    }
    expect(Object.keys(finals[0]).length).toBeGreaterThan(0);
    for (const page of pages) await expect(connectionBadge(page)).toBeHidden();
    for (const watcher of errors) expect(watcher.errors()).toEqual([]);

    // Teardown: closing the other four seats takes nothing else with it — no
    // reconnect churn on the survivor, and the room still relays for it.
    const survivor = pages[0];
    const sockets = await socketCount(survivor);
    for (const context of contexts.slice(1)) await context.close();
    await survivor.waitForTimeout(2_000);
    expect(await socketCount(survivor)).toBe(sockets);
    expect(await connectionState(survivor)).toBe('connected');

    const lateContext = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(lateContext);
    const late = await lateContext.newPage();
    await joinBoard(late, boardIdOf(survivor));
    const lastNote = await createNote(survivor);
    await expect(late.locator(`[data-note-id="${lastNote}"]`)).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});

/** A board id from a page URL, for joining from the first seat. */
function boardIdOf(page: Page): string {
  const match = /\/b\/([A-Za-z0-9_-]{22})/.exec(page.url());
  if (match === null) throw new Error(`expected a board URL, got ${page.url()}`);
  return match[1];
}

/** mulberry32 — small, deterministic, and enough to drive a soak. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['idea', 'sync', 'ship it', 'merge', 'draft', 'relay', 'zoom', 'note'];
const COLORS = Object.keys(STICKY_COLORS).filter((color) => color !== 'yellow');

const spotFor = (seat: number, slot: number): { x: number; y: number } => ({
  x: 190 + slot * GRID,
  y: 150 + seat * GRID,
});

/**
 * Do one random thing with the real UI on behalf of `seat`: create, move, type,
 * recolour or delete. Returns a description of what happened, or null when
 * nothing could be done at this moment (a covered note, a full row).
 */
async function randomEdit(
  page: Page,
  seat: number,
  slots: Array<string | null>,
  random: () => number,
): Promise<string | null> {
  let freeSlot = -1;
  for (const [slot, id] of slots.entries()) {
    if (id !== null) continue;
    if (await slotIsBusy(page, seat, slot)) continue;
    freeSlot = slot;
    break;
  }
  const held = slots.filter((id): id is string => id !== null);
  const grabbable: string[] = [];
  for (const id of held) {
    if (await ownsCentre(page, id)) grabbable.push(id);
  }

  const choices: Array<() => Promise<string>> = [];
  if (freeSlot !== -1) {
    choices.push(async () => {
      const id = await createNoteAt(page, spotFor(seat, freeSlot));
      slots[freeSlot] = id;
      return `create in slot ${freeSlot}`;
    });
  }
  const pick = (list: string[]): string => list[Math.floor(random() * list.length)];
  if (grabbable.length > 0) {
    choices.push(async () => {
      const id = pick(grabbable);
      const slot = slots.indexOf(id);
      const box = await noteBox(page, id);
      const home = spotFor(seat, slot);
      // Drift is bounded to the slot, so notes stay distinguishable over a minute.
      const target = { x: home.x + (random() * 2 - 1) * 22, y: home.y + (random() * 2 - 1) * 16 };
      await dragNoteBy(page, id, {
        x: Math.round(target.x - (box.x + box.width / 2)),
        y: Math.round(target.y - (box.y + box.height / 2)),
      });
      return `move ${id.slice(0, 8)}`;
    });
    choices.push(async () => {
      const id = pick(grabbable);
      await appendToNote(page, id, ` ${pick(WORDS)}`);
      return `type into ${id.slice(0, 8)}`;
    });
    choices.push(async () => {
      const id = pick(grabbable);
      await colourNote(page, id, pick(COLORS));
      return `recolour ${id.slice(0, 8)}`;
    });
    choices.push(async () => {
      const id = pick(grabbable);
      await deleteNote(page, id);
      slots[slots.indexOf(id)] = null;
      return `delete ${id.slice(0, 8)}`;
    });
  }

  if (choices.length === 0) return null;
  return choices[Math.floor(random() * choices.length)]();
}

/** Whether something already covers the middle of a note position. */
async function slotIsBusy(page: Page, seat: number, slot: number): Promise<boolean> {
  const at = spotFor(seat, slot);
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-note-id]') !== null,
    at,
  );
}
