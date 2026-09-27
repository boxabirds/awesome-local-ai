// Story 8, Task 5 — recover my mistakes while colleagues work (TC-22 to TC-24).
//
// Two or five real browser contexts on one board. Every action is real input
// (keyboard shortcuts, toolbar clicks, the editor); the only test seam is
// seeding existing content and reading the model back. Undo history is per
// tab: Mia can never undo Raj's work, and five people undoing at once must
// leave the board convergent.

import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  colorSticky,
  createRoom,
  deleteSticky,
  docState,
  errorCollector,
  moveSticky,
  openRoom,
  seedSticky,
  typeSticky,
  waitConverged,
  waitNoteCount,
} from './helpers/live';
import { snapshot } from './helpers/board';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

async function makeClient(browser: Browser, room: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await openRoom(page, room);
  return page;
}

/** A board-model row (position/size/colour/text as plain values). */
interface Row {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  z: number;
}

const rowsOf = async (page: Page): Promise<Record<string, Row>> =>
  Object.fromEntries(((await snapshot(page)) as unknown as Row[]).map((r) => [r.id, r]));

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });

test('TC-22 recover an accidental mass delete; Raj’s note is never touched', async ({ browser, request }) => {
  const room = await createRoom(request);
  const mia = await makeClient(browser, room);
  const raj = await makeClient(browser, room);
  const errors = errorCollector(mia).concat(errorCollector(raj));

  // Eight notes already on the board. Mia adds text to one and recolours
  // another — her own history will contain [type, colour, delete].
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) ids.push(await seedSticky(mia, 150 + i * 240, 150 + (i % 2) * 260));
  await waitNoteCount(raj, 8);
  await typeSticky(mia, ids[0], 'keep text');
  await colorSticky(mia, ids[7], 'blue');
  const before = await rowsOf(mia);
  expect(before[ids[0]].text).toBe('keep text');
  expect(before[ids[7]].color).toBe('blue');

  // Mia selects everything and deletes — the whole set vanishes on both.
  await mia.keyboard.press('Control+a');
  await mia.keyboard.press('Delete');
  await waitNoteCount(mia, 0);
  await waitNoteCount(raj, 0);

  // Raj adds a note while Mia is still reeling.
  const rajNote = await seedSticky(raj, 500, 500);
  await waitNoteCount(mia, 1);

  // Ctrl/Cmd+Z: the eight return ON BOTH screens, contents and places intact.
  await mia.keyboard.press('Control+z');
  await waitNoteCount(mia, 9);
  await waitNoteCount(raj, 9);
  const restored = await rowsOf(mia);
  for (const id of ids) {
    expect(restored[id].x).toBe(before[id].x);
    expect(restored[id].y).toBe(before[id].y);
    expect(restored[id].width).toBe(before[id].width);
    expect(restored[id].height).toBe(before[id].height);
    expect(restored[id].color).toBe(before[id].color);
    expect(restored[id].text).toBe(before[id].text);
  }
  expect(restored[rajNote]).toBeDefined(); // Raj's note untouched
  await expect.poll(async () => (await rowsOf(raj))[ids[0]]?.text).toBe('keep text'); // synced everywhere

  // Redo button: the eight disappear again on both screens.
  await redoButton(mia).click();
  await waitNoteCount(mia, 1);
  await waitNoteCount(raj, 1);
  expect(await rowsOf(mia)).toHaveProperty(rajNote);

  // Undo via the button until Mia's history runs dry: it ends disabled, the
  // deleted notes are back (that step undone), and Raj's work survives.
  await expect(undoButton(mia)).toBeEnabled();
  for (let i = 0; i < 10 && !(await undoButton(mia).isDisabled()); i++) {
    await undoButton(mia).click();
    await mia.waitForTimeout(50);
  }
  await expect(undoButton(mia)).toBeDisabled();
  const end = await rowsOf(mia);
  expect(Object.keys(end)).toHaveLength(9);
  expect(end[rajNote]).toBeDefined(); // nobody undid Raj's work

  expect(errors).toEqual([]);
  await mia.context().close();
  await raj.context().close();
});

test('TC-23 colleague deleted my object: undo skips the dead step, stays alive (error path)', async ({
  browser,
  request,
}) => {
  const room = await createRoom(request);
  const mia = await makeClient(browser, room);
  const raj = await makeClient(browser, room);
  const errors = errorCollector(mia).concat(errorCollector(raj));

  const a = await seedSticky(mia, 200, 200);
  const b = await seedSticky(mia, 700, 400);
  await waitNoteCount(raj, 2);
  const start = await rowsOf(mia);

  // Mia moves both notes (two steps in her history).
  await moveSticky(mia, a, start[a].x + 60, start[a].y + 20);
  await moveSticky(mia, b, start[b].x + 60, start[b].y + 20);
  await waitConverged([mia, raj]);

  // Raj deletes B.
  await deleteSticky(raj, b);
  await waitNoteCount(mia, 1);

  // Mia undoes: B's move is a dead step — Yjs skips it and lands on the move
  // of A instead. No error, B stays gone on both screens, A returns.
  await mia.keyboard.press('Control+z');
  const after = await rowsOf(mia);
  expect(after[b]).toBeUndefined();
  expect(after[a].x).toBeCloseTo(start[a].x, 1); // "next undo works": A's move reversed
  expect(after[a].y).toBeCloseTo(start[a].y, 1);
  await waitConverged([mia, raj]);

  expect(errors).toEqual([]);
  await mia.context().close();
  await raj.context().close();
});

test('TC-24 everyone undoing at once only reverts their own work', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages: Page[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) pages.push(await makeClient(browser, room));
  const errors: string[] = pages.flatMap((p) => errorCollector(p));

  // Two notes per editor: one everyone MOVES, one everyone TYPES INTO.
  // The grid must stay inside the 1280×800 viewport at zoom 1 (the camera
  // centres the world origin) — off-screen notes cannot be interacted with.
  const moved: string[] = [];
  const typed: string[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    moved.push(await seedSticky(pages[i], -340 + i * 210, -150));
    typed.push(await seedSticky(pages[i], -340 + i * 210, 250));
  }
  await Promise.all(pages.map((p) => waitNoteCount(p, MAX_CONCURRENT_EDITORS * 2)));
  const start = await rowsOf(pages[0]);

  // Each editor performs two distinct steps of their own: move, then typing
  // (the editor's mount/unmount keep the typing burst a separate step).
  for (let i = 0; i < pages.length; i++) {
    await moveSticky(pages[i], moved[i], start[moved[i]].x + 60, start[moved[i]].y + 45);
    await typeSticky(pages[i], typed[i], `editor ${i} text`);
  }
  await waitConverged(pages);

  // Everyone presses Ctrl/Cmd+Z. Undo #1: own typing burst gone.
  for (const p of pages) await p.keyboard.press('Control+z');
  await waitConverged(pages);
  // Undo #2: own move back to the start position.
  for (const p of pages) await p.keyboard.press('Control+z');
  await waitConverged(pages);

  // Every page: all moves reverted to their start positions, all texts empty
  // — each editor's undo only touched their own two steps.
  const end = await rowsOf(pages[0]);
  for (let i = 0; i < pages.length; i++) {
    expect(end[moved[i]].x).toBeCloseTo(start[moved[i]].x, 1);
    expect(end[moved[i]].y).toBeCloseTo(start[moved[i]].y, 1);
    expect(end[typed[i]].text).toBe('');
  }
  // ...and every board is identical (the convergence check), with no errors.
  const snaps = await Promise.all(pages.map((p) => docState(p)));
  expect(new Set(snaps).size).toBe(1);
  expect(errors).toEqual([]);
});
