// Story 7 end-to-end (TC-32 to TC-36): the selection machinery driven by a real
// mouse, in real browsers, against the real room.
//
// Everything is measured the way a user sees it - screen geometry for the pointer,
// the objects' own rendered boxes for the result, the number the bar says, the
// paint order for "who is on top". Objects are always found by the id each one
// carries, never by a DOM position, because a drag changes the paint order and an
// index would then name a different note.
//
// The board area is the 1280x720 the browser leaves it, with the toolbar, zoom
// controls, hint and share button floating over it, so every layout here is placed
// in world coordinates that land in the clear middle of the screen and drags are
// described in screen pixels and checked in world units.
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  gotoBoard,
  getCamera,
  setCamera,
  notes,
  noteScreenCenter,
  noteIdsInPaintOrder,
  createNoteAt,
  dragBy,
} from './helpers/sticky.ts';
import type { Cam } from './helpers/sticky.ts';
import { openBoard, newCollaborator } from './helpers/room.ts';
import { ensureBoard } from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.ts';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The board's own chrome, measured from the page: nothing a test clicks may fall
// inside these, or the test would be clicking a button instead of the board.
const TOOLBAR_ZONE = { x1: 8, y1: 320, x2: 90, y2: 400 };
const ZOOM_ZONE = { x1: 1015, y1: 650, x2: 1275, y2: 712 };
// world -> screen, through the live camera (screen = (world - cam) * zoom).
function toScreen(cam: Cam, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

function inside(p: { x: number; y: number }, zone: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return p.x >= zone.x1 && p.x <= zone.x2 && p.y >= zone.y1 && p.y <= zone.y2;
}

// Fail early, with the reason, if a pointer point would have hit the chrome.
function assertOnBoard(p: { x: number; y: number }, what: string): void {
  const zones: [string, { x1: number; y1: number; x2: number; y2: number }][] = [
    ['board tools', TOOLBAR_ZONE],
    ['zoom controls', ZOOM_ZONE],
  ];
  for (const [name, zone] of zones) {
    if (inside(p, zone)) throw new Error(`${what} at ${Math.round(p.x)},${Math.round(p.y)} would hit the ${name}`);
  }
  if (p.x < 0 || p.x > 1275 || p.y < 0 || p.y > 715) {
    throw new Error(`${what} at ${Math.round(p.x)},${Math.round(p.y)} is off the board`);
  }
}

// Every object's world rect, keyed by the id its element carries.
async function rectsById(page: Page): Promise<Record<string, Rect>> {
  return page.$$eval('[role="group"][aria-label="Sticky note"]', (els) => {
    const out: Record<string, Rect> = {};
    for (const el of els) {
      const e = el as HTMLElement;
      out[e.dataset.objectId ?? ''] = {
        x: parseFloat(e.style.left),
        y: parseFloat(e.style.top),
        width: parseFloat(e.style.width),
        height: parseFloat(e.style.height),
      };
    }
    return out;
  });
}

function note(page: Page, id: string): Locator {
  return page.locator(`[role="group"][aria-label="Sticky note"][data-object-id="${id}"]`);
}

// How many objects the board itself says are selected. The bar's number is not
// always the instrument: one sticky note selected shows the note's own toolbar
// instead of a count, so the objects are asked directly.
async function selectedCount(page: Page): Promise<number> {
  return page.locator('[role="group"][aria-label="Sticky note"][data-selected="true"]').count();
}

// The number the bar says, or null when the bar is not there.
async function selectionCountText(page: Page): Promise<string | null> {
  const el = page.locator('[data-testid="selection-count"]');
  if ((await el.count()) === 0) return null;
  return (await el.innerText()).trim();
}

// The ids the overlay outlined - one outline per selected object.
async function selectedIds(page: Page): Promise<string[]> {
  return page.$$eval('.selection-outline[data-object-id]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.objectId ?? ''),
  );
}

// The world rect the selection box encloses, un-projected from the screen through
// the camera it was drawn with.
async function selectionBoxWorld(page: Page): Promise<Rect> {
  const cam = await getCamera(page);
  const box = await page.locator('[data-testid="selection-box"]').boundingBox();
  if (!box) throw new Error('the selection box is not on screen');
  return {
    x: box.x / cam.zoom + cam.x,
    y: box.y / cam.zoom + cam.y,
    width: box.width / cam.zoom,
    height: box.height / cam.zoom,
  };
}

function unionOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

// Create a note whose top-left lands at a world point, by double-clicking the
// empty board where that point is on screen, then leave the editor.
async function createNoteAtWorld(page: Page, world: { x: number; y: number }): Promise<void> {
  const cam = await getCamera(page);
  const centre = toScreen(cam, {
    x: world.x + STICKY_SIZE_WORLD / 2,
    y: world.y + STICKY_SIZE_WORLD / 2,
  });
  assertOnBoard(centre, 'the point a note is created at');
  await createNoteAt(page, centre.x, centre.y);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
}

// The user's way to start a selection from nothing: Escape. Creating a note leaves
// it selected, and a marquee adds to what is already selected, so a test that means
// to measure the marquee alone has to empty the selection first.
async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  expect(await selectedCount(page)).toBe(0);
}

// Shift+drag across empty board space: the selection rectangle, described in world
// units because that is what the test is about.
async function marquee(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cam = await getCamera(page);
  const a = toScreen(cam, from);
  const b = toScreen(cam, to);
  assertOnBoard(a, 'the start of the selection rectangle');
  assertOnBoard(b, 'the end of the selection rectangle');
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}

// Press the middle of a locator and move by a screen offset.
async function dragLocatorBy(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('the thing to drag has no box on screen');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assertOnBoard(from, 'the point a drag starts at');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// TC-32: one note fully inside the rectangle, one straddling its edge, one well
// outside. Only the one inside becomes selected, and the board did not pan away.
test('TC-32 a marquee selects only what is fully inside it', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: -500, y: -360, zoom: 1 });
  await createNoteAtWorld(page, { x: 0, y: 0 }); // inside
  await createNoteAtWorld(page, { x: 150, y: 0 }); // straddles the right edge
  await createNoteAtWorld(page, { x: 400, y: 0 }); // outside
  await expect(notes(page)).toHaveCount(3);

  const ids = (await noteIdsInPaintOrder(page)).map((t) => t.replace('sticky-', ''));
  const cam = await getCamera(page);

  await clearSelection(page);
  await marquee(page, { x: -50, y: -50 }, { x: 200, y: 260 });

  expect(await selectedCount(page)).toBe(1);
  expect(await selectedIds(page)).toEqual([ids[0]]);
  await expect(note(page, ids[0])).toHaveAttribute('data-selected', 'true');
  await expect(note(page, ids[1])).toHaveAttribute('data-selected', 'false');
  await expect(note(page, ids[2])).toHaveAttribute('data-selected', 'false');
  // The rectangle took the pointer, so nothing panned.
  expect(await getCamera(page)).toEqual(cam);

  // A second rectangle adds to the selection rather than replacing it: this one
  // takes the note outside the first one, and the first stays. Two objects
  // selected is when the selection bar itself appears, with its number.
  await marquee(page, { x: 390, y: -50 }, { x: 610, y: 260 });
  expect(await selectedCount(page)).toBe(2);
  expect(await selectionCountText(page)).toBe('2 selected');
  // Which two, in whatever order the overlay drew them.
  expect([...(await selectedIds(page))].sort()).toEqual([ids[0], ids[2]].sort());
});

// TC-33: the selection moves 300 world units as one, painted over the note that
// was not part of it; then one corner handle scales sizes and gaps together, and
// every note keeps its shape.
test('TC-33 a selection moves together and resizes together', async ({ page }) => {
  await gotoBoard(page);
  // Zoomed out, so a 3 x 2 grid plus room to grow fits on one screen.
  await setCamera(page, { x: -100, y: -100, zoom: 0.5 });
  const grid = [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 520, y: 0 },
    { x: 0, y: 260 },
    { x: 260, y: 260 },
    { x: 520, y: 260 },
  ];
  for (const world of grid) await createNoteAtWorld(page, world);
  // The note nobody selects.
  await createNoteAtWorld(page, { x: 780, y: 0 });
  await expect(notes(page)).toHaveCount(7);

  const paint = await noteIdsInPaintOrder(page); // creation order: nothing dragged
  const picked = paint.slice(0, 6).map((t) => t.replace('sticky-', ''));
  const unpicked = paint[6].replace('sticky-', '');

  // Box-select the grid; the other note is outside the rectangle.
  await clearSelection(page);
  await marquee(page, { x: -40, y: -40 }, { x: 740, y: 500 });
  expect(await selectionCountText(page)).toBe('6 selected');
  const before = await rectsById(page);
  const zoom = (await getCamera(page)).zoom;

  // 150 screen pixels at this zoom is the 300 world units the story asks for.
  const MOVE = { x: 150, y: 0 };
  await dragLocatorBy(page, note(page, picked[0]), MOVE.x, MOVE.y);
  const moved = await rectsById(page);
  const world = { x: MOVE.x / zoom, y: MOVE.y / zoom };
  for (const id of picked) {
    expect(moved[id].x).toBeCloseTo(before[id].x + world.x, 1);
    expect(moved[id].y).toBeCloseTo(before[id].y + world.y, 1);
    expect(moved[id].width).toBeCloseTo(before[id].width, 1); // moving never resizes
  }
  expect(moved[unpicked]).toEqual(before[unpicked]);

  // The unselected note was created last, so it began on top; the drag put the
  // whole selection above it, and kept the order the selection had inside itself.
  const paintAfter = await noteIdsInPaintOrder(page);
  expect(paintAfter[0].replace('sticky-', '')).toBe(unpicked);
  expect(paintAfter.slice(1)).toEqual(paint.slice(0, 6));

  // Now one corner handle, out by 150 screen pixels again - 300 world units.
  const box = await selectionBoxWorld(page);
  expect(box.width).toBeCloseTo(720, 0);
  expect(box.height).toBeCloseTo(460, 0);
  const was = await rectsById(page);
  const HANDLE = { x: 150, y: 150 };
  const handleBox = await page.locator('[data-handle="se"]').boundingBox();
  if (!handleBox) throw new Error('the bottom-right handle is not on screen');
  const boxBefore = await page.locator('[data-testid="selection-box"]').boundingBox();
  if (!boxBefore) throw new Error('the selection box is not on screen');
  // The handle is where the box's bottom-right corner is; the box itself is the
  // instrument the resize is read from afterwards.
  void handleBox;
  await dragLocatorBy(page, page.locator('[data-handle="se"]'), HANDLE.x, HANDLE.y);

  const after = await rectsById(page);
  // Notes are aspect-locked, so the whole selection took one uniform scale, and
  // the corner that was dragged ended up under the pointer where it was released.
  const grown = unionOf(picked.map((id) => after[id]));
  const before2 = unionOf(picked.map((id) => was[id]));
  const boxAfter = await page.locator('[data-testid="selection-box"]').boundingBox();
  if (!boxAfter) throw new Error('the selection box went away mid-resize');
  const growX = boxAfter.x + boxAfter.width - (boxBefore.x + boxBefore.width);
  const growY = boxAfter.y + boxAfter.height - (boxBefore.y + boxBefore.height);
  // Notes hold their shape, so the box did too: the axis pulled further for its
  // own length got exactly what it was pulled by, and the other one followed the
  // shape rather than the pointer.
  const offX = Math.abs(growX - HANDLE.x);
  const offY = Math.abs(growY - HANDLE.y);
  expect(Math.min(offX, offY)).toBeLessThan(1);
  expect(Math.max(offX, offY)).toBeGreaterThan(1);

  const scale = grown.width / before2.width;
  expect(scale).toBeCloseTo(grown.height / before2.height, 3); // one scale, so no note is stretched
  expect(scale).toBeGreaterThan(1);
  for (const id of picked) {
    const r = after[id];
    expect(r.height).toBeCloseTo(r.width, 1); // still square
    expect(r.width / was[id].width).toBeCloseTo(scale, 3); // the same scale for all of them
    // The box did not slide: it grew out of the corner the handle is not on.
    expect(grown.x).toBeCloseTo(before2.x, 1);
    expect(grown.y).toBeCloseTo(before2.y, 1);
    expect(r.x).toBeCloseTo(before2.x + (was[id].x - before2.x) * scale, 1);
    expect(r.y).toBeCloseTo(before2.y + (was[id].y - before2.y) * scale, 1);
  }
  // The gap between neighbours grew by that same scale, not by a fixed amount.
  const gapBefore = was[picked[1]].x - (was[picked[0]].x + was[picked[0]].width);
  const gapAfter = after[picked[1]].x - (after[picked[0]].x + after[picked[0]].width);
  expect(gapBefore).toBeCloseTo(60, 1);
  expect(gapAfter).toBeCloseTo(gapBefore * scale, 1);
  // And the note that was left out is exactly as it was.
  expect(after[unpicked]).toEqual(was[unpicked]);
  // The overlay's box grew with the selection it describes.
  const grownBox = await selectionBoxWorld(page);
  expect(grownBox.width).toBeCloseTo(before2.width * scale, 0);
});

// TC-34: the arrows move the whole selection without scrolling the page or panning
// the board, and Delete takes all of it away at once.
test('TC-34 arrows nudge and Delete removes the selection', async ({ page }) => {
  await gotoBoard(page);
  await setCamera(page, { x: -400, y: -200, zoom: 1 });
  for (const world of [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 0, y: 260 },
  ]) {
    await createNoteAtWorld(page, world);
  }
  await expect(notes(page)).toHaveCount(3);

  await page.keyboard.press('Control+A');
  await expect(page.locator('[data-testid="selection-count"]')).toHaveText('3 selected');

  const cam = await getCamera(page);
  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    docTop: document.documentElement.scrollTop,
    bodyTop: document.body.scrollTop,
  }));
  const before = await rectsById(page);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowUp');
  await page.waitForTimeout(140);

  const after = await rectsById(page);
  for (const id of Object.keys(before)) {
    expect(after[id].x).toBeCloseTo(before[id].x + 3 * NUDGE_STEP_WORLD, 3);
    expect(after[id].y).toBeCloseTo(before[id].y - NUDGE_LARGE_STEP_WORLD, 3);
  }
  expect(await getCamera(page)).toEqual(cam); // the board never panned
  expect(
    await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      docTop: document.documentElement.scrollTop,
      bodyTop: document.body.scrollTop,
    })),
  ).toEqual(scroll); // and the page never scrolled

  await page.keyboard.press('Delete');
  await page.waitForTimeout(140);
  await expect(notes(page)).toHaveCount(0);
  expect(await selectionCountText(page)).toBeNull();
  expect(await selectedIds(page)).toHaveLength(0);
});

// TC-35: two people, one board. Sam deletes one of the three notes Lee had
// selected; Lee's selection falls to two without Lee touching anything.
test('TC-35 a colleague deleting a selected note shrinks my selection', async ({ browser }) => {
  const boardId = newBoardId();
  await ensureBoard(boardId);

  const lee = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openBoard(lee, boardId);
  await setCamera(lee, { x: -400, y: -200, zoom: 1 });
  for (const world of [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 520, y: 0 },
  ]) {
    await createNoteAtWorld(lee, world);
  }
  await lee.keyboard.press('Control+A');
  await expect(lee.locator('[data-testid="selection-count"]')).toHaveText('3 selected');
  const leeSelected = await selectedIds(lee);
  expect(leeSelected).toHaveLength(3);

  const sam = await newCollaborator(browser);
  await openBoard(sam, boardId);
  await expect(notes(sam)).toHaveCount(3);

  // Sam selects the middle note - a press and release with nothing between them -
  // and deletes it.
  const middle = note(sam, leeSelected[1]);
  await dragLocatorBy(sam, middle, 0, 0);
  expect(await selectedCount(sam)).toBe(1);
  await sam.keyboard.press('Delete');

  await expect(lee.locator('[data-testid="selection-count"]')).toHaveText('2 selected');
  await expect(notes(lee)).toHaveCount(2);
  // Lee lost exactly the note that went away, and still has the other two.
  const still = await selectedIds(lee);
  expect(still).toHaveLength(2);
  expect(still).not.toContain(leeSelected[1]);
  expect(still.sort()).toEqual([leeSelected[0], leeSelected[2]].sort());
  await expect(lee.locator('[data-testid="selection-bar"]')).toBeVisible();

  await lee.close();
  await sam.close();
});

// TC-36: the board at full editing capacity. MAX_CONCURRENT_EDITORS people drag
// MAX_CONCURRENT_EDITORS different notes at the same time; each note lands where
// its own drag left it - nowhere in between - and all of them see the same board.
test('TC-36 full capacity moves different notes at once and converges', async ({ browser }) => {
  const boardId = newBoardId();
  await ensureBoard(boardId);

  const first = await newCollaborator(browser);
  await openBoard(first, boardId);
  // Where every page's own camera puts these is not the point; each page does its
  // own arithmetic. They are all the default camera here, in the clear middle.
  const spots = [
    { x: -300, y: -260 },
    { x: 0, y: -260 },
    { x: -300, y: 0 },
    { x: 0, y: 0 },
    { x: 300, y: 0 },
  ].slice(0, MAX_CONCURRENT_EDITORS);
  for (const world of spots) await createNoteAtWorld(first, world);
  await expect(notes(first)).toHaveCount(MAX_CONCURRENT_EDITORS);

  const people = [first];
  for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
    const other = await newCollaborator(browser);
    await openBoard(other, boardId);
    people.push(other);
  }
  for (const person of people) await expect(notes(person)).toHaveCount(MAX_CONCURRENT_EDITORS);

  // Each note keeps its own id, so a drag can be attributed to it afterwards.
  const ids = await first.$$eval('[role="group"][aria-label="Sticky note"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.objectId ?? ''),
  );
  expect(new Set(ids).size).toBe(MAX_CONCURRENT_EDITORS);

  const starts = await rectsById(first);
  // A different distance for each person, so no two drags could be confused.
  const moves = ids.map((_, i) => ({ dx: 40 + i * 20, dy: 25 + i * 13 }));

  await Promise.all(
    people.map(async (person, i) => {
      const target = note(person, ids[i]);
      const centre = await noteScreenCenter(target);
      await dragBy(person, centre, moves[i].dx, moves[i].dy);
    }),
  );

  const expected = ids.map((id, i) => ({
    x: starts[id].x + moves[i].dx,
    y: starts[id].y + moves[i].dy,
  }));
  for (const person of people) {
    const seen = await rectsById(person);
    ids.forEach((id, i) => {
      expect(seen[id].x).toBeCloseTo(expected[i].x, 0);
      expect(seen[id].y).toBeCloseTo(expected[i].y, 0);
    });
  }

  for (const person of people) await person.close();
});
