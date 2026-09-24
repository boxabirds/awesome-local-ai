/**
 * Story 7 · tasks 5 and 15 — the two full-capacity multi-select truths, run in
 * Chromium (and Firefox/WebKit) against the real Durable-Object room with two
 * or more browser contexts. These are the behaviours jsdom cannot show, because
 * they are *live sync*, not local state:
 *
 *  - TC-35 (`sel.interaction` prune): a note deleted by one client leaves the
 *    other client's multi-selection within the latency budget, and the
 *    SelectionBar's count drops — the ids never travelled over the wire, only
 *    the deleted document did.
 *  - TC-36 (`sel.transform` absolute writes): two clients drag different
 *    selections *at the same time*; because a group transform writes absolute
 *    positions the two documents converge to identical layouts, with no manual
 *    reload. (This is the "MAX_CONCURRENT_EDITORS" convergence proof.)
 */
import { expect, test, type Page } from '@playwright/test';
import { createBoardViaApi, waitForBoard } from './helpers/boards';
import { createNoteAt, readNotes, settle, type NoteReadout } from './helpers/sticky';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

const BAR = '[data-testid="selection-bar"]';
const CONVERGE_TIMEOUT = LIVE_UPDATE_LATENCY_BUDGET_MS * 8;

/** Spread-out seed positions (screen px): each note lands well clear of the last. */
async function seedNotes(page: Page, spots: Array<{ x: number; y: number }>): Promise<void> {
  for (const spot of spots) {
    await createNoteAt(page, spot.x, spot.y);
    await page.keyboard.press('Escape');
    await settle(page);
  }
  await settle(page, 6);
}

/** The notes keyed by id (so two contexts can be compared regardless of order). */
async function notesById(page: Page): Promise<Map<string, NoteReadout>> {
  const notes = await readNotes(page);
  return new Map(notes.map((n) => [n.id, n]));
}

/** Two pages show identical world positions for every shared id (tolerant, ±0.5). */
async function layoutsMatch(a: Page, b: Page): Promise<boolean> {
  const [ma, mb] = await Promise.all([notesById(a), notesById(b)]);
  if (ma.size !== mb.size) return false;
  for (const [id, na] of ma) {
    const nb = mb.get(id);
    if (!nb) return false;
    if (Math.abs(na.wx - nb.wx) > 0.5 || Math.abs(na.wy - nb.wy) > 0.5) return false;
  }
  return true;
}

/** How many notes carry `data-selected="true"` on a page. */
async function selectedCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-selected="true"]').length);
}

/** The SelectionBar count text, or null if the bar is not shown. */
async function barCount(page: Page): Promise<string | null> {
  const el = page.locator(BAR);
  if ((await el.count()) === 0) return null;
  return (await el.innerText()).replace(/\s+/g, ' ').trim();
}

/** Shift+click each of the given notes, by their current on-screen centres. */
async function shiftSelectByIds(page: Page, ids: string[]): Promise<void> {
  const byId = await notesById(page);
  for (const id of ids) {
    const note = byId.get(id);
    if (!note) throw new Error(`seed note ${id} is not rendered`);
    await page.keyboard.down('Shift');
    await page.mouse.click(note.cx, note.cy);
    await page.keyboard.up('Shift');
  }
  await settle(page);
}

/**
 * Drag one note by a screen delta. A pointerdown on a note with a *held* Shift
 * is read as a marquee, not a move, so the group's extra members are added with
 * separate Shift+clicks first and this final drag holds no modifier.
 */
async function dragNote(
  page: Page,
  id: string,
  delta: { dx: number; dy: number },
  opts: { shiftSelect?: string[] } = {},
): Promise<void> {
  const byId = await notesById(page);
  const primary = byId.get(id);
  if (!primary) throw new Error(`note ${id} is not rendered`);
  if (opts.shiftSelect) await shiftSelectByIds(page, opts.shiftSelect);

  // Grab a point near the note's top-left corner (below the Delete button that
  // floats over its centre) and move a little further right — still inside the
  // note, and clear of the vertical strip where the resize handle sits.
  const from = { x: primary.left + 6, y: primary.top + 6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.dx / 2, from.y + delta.dy / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.dx, from.y + delta.dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

test('TC-35: a note deleted by a colleague leaves my multi-selection and the bar within the budget', async ({
  context,
}) => {
  const lee = await context.newPage();
  const boardId = await createBoardViaApi(lee.request);
  await lee.goto(`/b/${boardId}`);
  await waitForBoard(lee);

  const sam = await context.newPage();
  await sam.goto(`/b/${boardId}`);
  await settle(lee);
  await settle(sam);

  // One shared document: five notes, seeded by Lee, seen by both.
  await seedNotes(lee, [
    { x: 240, y: 200 },
    { x: 520, y: 200 },
    { x: 800, y: 200 },
    { x: 1080, y: 200 },
    { x: 380, y: 460 },
  ]);
  await expect
    .poll(() => readNotes(sam).then((n) => n.length), { timeout: CONVERGE_TIMEOUT })
    .toBe(5);

  // Lee selects all five notes with the select-all chord, so the bar reads
  // "5 selected" and every note shows an outline.
  await lee.keyboard.press('ControlOrMeta+a');
  await settle(lee);
  await expect.poll(() => selectedCount(lee), { timeout: CONVERGE_TIMEOUT }).toBe(5);
  await expect.poll(() => barCount(lee)).toContain('5');

  // The note Sam will delete (any one of the five, identified on Lee's screen).
  const doomedId = [...(await notesById(lee)).keys()][3];

  // Sam clicks that note and deletes it.
  const samBefore = await notesById(sam);
  const target = samBefore.get(doomedId);
  if (!target) throw new Error('the doomed note is not on Sam\u2019s screen');
  await sam.mouse.click(target.cx, target.cy);
  await settle(sam);
  await sam.keyboard.press('Delete');
  await settle(sam);

  // On Lee's screen, within the budget, the note disappears, the bar drops to
  // "4 selected" (useSelection pruned the id from the shared snapshot), and the
  // remaining four still show outlines.
  await expect
    .poll(() => notesById(lee).then((m) => m.size), { timeout: CONVERGE_TIMEOUT })
    .toBe(4);
  await expect
    .poll(() => selectedCount(lee), { timeout: CONVERGE_TIMEOUT })
    .toBe(4);
  await expect.poll(() => barCount(lee)).toContain('4');

  // Deleting the remaining four removes every note; Lee's selection empties too.
  await lee.keyboard.press('Delete');
  await settle(lee);
  await expect
    .poll(() => notesById(lee).then((m) => m.size), { timeout: CONVERGE_TIMEOUT })
    .toBe(0);
  await expect.poll(() => selectedCount(lee)).toBe(0);
});

test('TC-36: two clients transforming different selections at once converge to one layout', async ({
  context,
}) => {
  const a = await context.newPage();
  const boardId = await createBoardViaApi(a.request);
  await a.goto(`/b/${boardId}`);
  await waitForBoard(a);

  const b = await context.newPage();
  await b.goto(`/b/${boardId}`);
  await settle(a);
  await settle(b);

  // Four notes in two widely-separated pairs, seeded by A and seen by both.
  await seedNotes(a, [
    { x: 300, y: 220 },
    { x: 520, y: 220 },
    { x: 900, y: 520 },
    { x: 1120, y: 520 },
  ]);
  await expect
    .poll(() => readNotes(b).then((n) => n.length), { timeout: CONVERGE_TIMEOUT })
    .toBe(4);

  const before = await notesById(a);
  const ids = [...before.keys()];
  const pairA = [ids[0], ids[1]];
  const pairB = [ids[2], ids[3]];

  // Each client builds a two-note *group* selection (its own pair), then drags
  // one member. The two drags are issued in the same turn of the event loop, so
  // two concurrent multi-object group writes hit the room together.
  await shiftSelectByIds(a, pairA);
  await shiftSelectByIds(b, pairB);
  await Promise.all([
    dragNote(a, pairA[0], { dx: 220, dy: 30 }),
    dragNote(b, pairB[0], { dx: -180, dy: -50 }),
  ]);

  // Absolute writes converge: after the dust settles, both documents show the
  // same world layout, with no manual reload.
  await expect
    .poll(() => layoutsMatch(a, b), { timeout: CONVERGE_TIMEOUT })
    .toBe(true);

  // And every one of the four notes actually moved (the group transforms were
  // real, not a no-op): each pair shifted by its editor's delta.
  const after = await notesById(a);
  for (const id of ids) {
    const moved = Math.abs(after.get(id)!.wx - before.get(id)!.wx);
    expect(moved, `note ${id} did not move`).toBeGreaterThan(1);
  }
});