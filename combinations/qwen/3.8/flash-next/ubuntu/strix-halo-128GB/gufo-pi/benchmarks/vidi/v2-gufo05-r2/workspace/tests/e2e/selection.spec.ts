/**
 * Story 7 end to end: selecting several objects at once, moving them together,
 * resizing the group and commanding it from the keyboard, in real browsers against a
 * real room.
 *
 * Every case puts the camera at `{x: 0, y: 0, zoom: 1}`, so one board unit is one
 * screen pixel from the board's own top-left: a rectangle described by two numbers in
 * a test is the rectangle the person sees, and what is asserted afterwards is the
 * board's own state, read out of the shared document rather than off the screen.
 *
 * Notes are laid out no closer than 40 units apart and never under the toolbar down
 * the left edge, because these tests click and drag with a real mouse.
 *
 * TC-32 a marquee selects what is fully inside it · TC-33 a group moves together, is
 * raised above the rest, resizes as one picture and stops at the smallest size its type
 * allows · TC-34 the keyboard nudges and deletes a selection without moving the page ·
 * TC-35 somebody else deleting an object takes it out of your selection · TC-36
 * `MAX_CONCURRENT_EDITORS` people moving different selections at once all end up
 * looking at the same board.
 */

import type { Page } from '@playwright/test';

import { expect, test } from './helpers/live';
import { expectNoPendingCameraFrame, setCamera, type Pixel } from './helpers/board';
import { getNotes, noteBoxes } from './helpers/notes';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';

const NOTE = STICKY_SIZE_WORLD;
/** One board unit to one screen pixel, from the board's top-left corner. */
const FLAT = { x: 0, y: 0, zoom: 1 };

interface SelectionHooks {
  seedSticky(centreX: number, centreY: number): string;
  selectedIds(): string[];
}

/**
 * Put a note on the board with its top-left at this board point. The hook takes the
 * point a double-click would have made, which is the note's centre.
 */
async function seedAt(page: Page, x: number, y: number): Promise<string> {
  const id = await page.evaluate(
    ([centreX, centreY]) => {
      const w = window as unknown as { __vidi6?: SelectionHooks };
      if (!w.__vidi6?.seedSticky) {
        throw new Error('seedSticky missing: e2e needs a test build');
      }
      return w.__vidi6.seedSticky(centreX, centreY);
    },
    [x + NOTE / 2, y + NOTE / 2],
  );
  await expect(page.locator(`[data-note-id="${id}"]`)).toBeVisible();
  return id;
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __vidi6?: SelectionHooks };
    if (!w.__vidi6?.selectedIds) {
      throw new Error('selectedIds missing: e2e needs a test build');
    }
    return w.__vidi6.selectedIds();
  });
}

/** Open a board of the test's own, with the flat camera laid over it. */
async function openFlatBoard(page: Page): Promise<Pixel> {
  await page.goto('/');
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await setCamera(page, FLAT);
  const box = await page.getByTestId('board-viewport').boundingBox();
  if (!box) throw new Error('the board has no bounding box');
  return { x: box.x, y: box.y };
}

async function centre(page: Page, id: string): Promise<Pixel> {
  const box = (await noteBoxes(page))[id];
  if (!box) throw new Error(`note ${id} is not on this screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real mouse drag with the steps a hand has; shift turns it into a marquee. */
async function drag(page: Page, from: Pixel, to: Pixel, shift = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await expectNoPendingCameraFrame(page);
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
  if (shift) await page.keyboard.up('Shift');
}

/** Select these notes: one click, then shift-clicks. */
async function select(page: Page, ids: readonly string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    const at = await centre(page, id);
    if (index > 0) await page.keyboard.down('Shift');
    await page.mouse.click(at.x, at.y);
    if (index > 0) await page.keyboard.up('Shift');
  }
  await expectNoPendingCameraFrame(page);
}

/** A note's geometry. The model leaves each field optional; a placed note has them. */
interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
}

function placed(note: Partial<StickySnapshot> | undefined): Placed {
  return {
    x: note?.x ?? 0,
    y: note?.y ?? 0,
    width: note?.width ?? 0,
    height: note?.height ?? 0,
    z: note?.z ?? 0,
  };
}

/** The board's own notes, keyed by id, for asserting in board units. */
async function notesById(page: Page): Promise<Record<string, Placed>> {
  const out: Record<string, Placed> = {};
  for (const note of await getNotes(page)) out[note.id] = placed(note);
  return out;
}

/** The world layer's transform: where the camera is, without asking the app. */
async function worldTransform(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>('[data-testid="board-world"]')?.style.transform ?? '',
  );
}

/** A handle's screen point, taken from the outline the page draws. */
async function handlePoint(page: Page, handle: string): Promise<Pixel> {
  const box = await page
    .locator(`[data-resize-handle="${handle}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`no "${handle}" resize handle on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Six notes in a 3x2 grid with a 40-unit gap, top-left of the first at (100, 120). */
async function seedGrid(page: Page): Promise<string[]> {
  const ids: string[] = [];
  for (const [column, row] of [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]) {
    ids.push(await seedAt(page, 100 + column * (NOTE + 40), 120 + row * (NOTE + 40)));
  }
  return ids;
}

test('TC-32: a marquee selects what is fully inside it, and nothing else', async ({ page }) => {
  const origin = await openFlatBoard(page);
  const at = (p: Pixel): Pixel => ({ x: origin.x + p.x, y: origin.y + p.y });
  const a = await seedAt(page, 100, 100);
  const b = await seedAt(page, 250, 100); // overlaps a, so it can be half covered
  const c = await seedAt(page, 700, 450);

  // From just outside a's top-left to half way across b: a is inside on all four
  // edges, b sticks out of the right, c is nowhere near it.
  await drag(page, at({ x: 80, y: 80 }), at({ x: 350, y: 320 }), true);

  await expect
    .poll(() => selectedIds(page), { timeout: 5_000 })
    .toEqual([a]);
  await expect(page.locator('[data-testid="marquee"]')).toHaveCount(0);
  // A marquee selects; it does not change the board.
  const notes = await notesById(page);
  expect(placed(notes[a]).x).toBe(100);
  expect(placed(notes[b]).x).toBe(250);
  expect(placed(notes[c]).x).toBe(700);
});

test('TC-33: a moved group keeps its layout and lands above everything else', async ({
  page,
}) => {
  await openFlatBoard(page);
  const ids = await seedGrid(page);
  // Under the group's middle: it overlaps the four notes around it without covering
  // any of their centres, so the clicks below still land on the notes they name.
  const below = await seedAt(page, 220, 240);
  await select(page, ids);
  expect(await selectedIds(page)).toHaveLength(6);

  const before = await notesById(page);
  const grab = await centre(page, ids[0]!);
  await drag(page, grab, { x: grab.x + 300, y: grab.y + 60 });

  const after = await notesById(page);
  for (const id of ids) {
    expect(placed(after[id]).x - placed(before[id]).x).toBe(300);
    expect(placed(after[id]).y - placed(before[id]).y).toBe(60);
  }
  // The whole group is raised above the note it passed over, and keeps its own order:
  // the note created last is still the topmost of the six.
  for (const id of ids) expect(placed(after[id]).z).toBeGreaterThan(placed(after[below]).z);
  expect(placed(after[ids[5]]).z).toBeGreaterThan(placed(after[ids[0]]).z);
  // Anything nobody selected stayed exactly where it was.
  expect(placed(after[below]).x).toBe(220);
});

test('TC-33: a resized group stays a scaled picture of itself and stops at the minimum', async ({
  page,
}) => {
  await openFlatBoard(page);
  const ids = await seedGrid(page);
  await select(page, ids);

  const before = await notesById(page);
  const anchorX = Math.min(...ids.map((id) => placed(before[id]).x));
  const anchorY = Math.min(...ids.map((id) => placed(before[id]).y));
  const gapBefore = placed(before[ids[1]]).x - (placed(before[ids[0]]).x + NOTE);

  // Pull the bottom-right corner of the whole selection out. Sticky notes keep their
  // proportions, so the group grows as a scaled picture of itself.
  const corner = await handlePoint(page, 'se');
  await drag(page, corner, { x: corner.x + 220, y: corner.y + 40 });

  const grown = await notesById(page);
  const first = placed(grown[ids[0]]);
  const scale = first.width / NOTE;
  expect(scale).toBeGreaterThan(1);
  for (const id of ids) {
    const note = placed(grown[id]);
    // Every note is scaled by the same amount, and is still square.
    expect(note.width).toBe(Math.round(NOTE * scale));
    expect(note.width).toBe(note.height);
    // And it sits where the scaled layout puts it (the group's top-left is the anchor).
    expect(Math.abs(note.x - (anchorX + (before[id]!.x - anchorX) * scale))).toBeLessThanOrEqual(1);
    expect(Math.abs(note.y - (anchorY + (before[id]!.y - anchorY) * scale))).toBeLessThanOrEqual(1);
  }
  // The gap between neighbours grew by the same factor: the picture scaled, the notes
  // did not drift apart.
  const gapAfter = placed(grown[ids[1]]).x - (first.x + first.width);
  expect(Math.abs(gapAfter - gapBefore * scale)).toBeLessThanOrEqual(2);

  // Shrink it as hard as the pointer can: the group stops at the smallest size the
  // type allows instead of collapsing or going negative.
  const next = await handlePoint(page, 'se');
  await drag(page, next, { x: next.x - 6000, y: next.y - 6000 });
  const shrunk = await notesById(page);
  for (const id of ids) {
    expect(placed(shrunk[id]).width).toBe(STICKY_MIN_SIZE_WORLD);
    expect(placed(shrunk[id]).height).toBe(STICKY_MIN_SIZE_WORLD);
  }
});

test('TC-34: the keyboard nudges a selection without moving the page, and deletes it', async ({
  page,
}) => {
  await openFlatBoard(page);
  const ids = await seedGrid(page);
  const other = await seedAt(page, 900, 620);
  await select(page, ids);

  const before = await notesById(page);
  const cameraBefore = await worldTransform(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expectNoPendingCameraFrame(page);

  const nudged = await notesById(page);
  const step = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
  for (const id of ids) {
    expect(placed(nudged[id]).x - placed(before[id]).x).toBe(step);
    expect(placed(nudged[id]).y).toBe(placed(before[id]).y);
  }
  // The page did not scroll and the board did not pan: the keys moved the objects.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await worldTransform(page)).toBe(cameraBefore);
  expect(placed(nudged[other]).x).toBe(900);

  await page.keyboard.press('Delete');
  await expect
    .poll(() => getNotes(page).then((notes) => notes.map((note) => note.id)), { timeout: 5_000 })
    .toEqual([other]);
  expect(await selectedIds(page)).toEqual([]);
  await expect(page.locator('[data-testid="selection-overlay"]')).toHaveCount(0);
});

test('TC-35: a note somebody else deletes leaves the selection here', async ({ liveBoards }) => {
  const { people } = await liveBoards.open(['Lee', 'Sam']);
  const lee = people[0]!;
  const sam = people[1]!;
  await setCamera(lee.page, FLAT);
  await setCamera(sam.page, FLAT);

  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) ids.push(await seedAt(lee.page, 120 + i * 240, 200));
  // Lee shift-drags a rectangle around all four.
  await drag(lee.page, { x: 100, y: 180 }, { x: 1180, y: 420 }, true);
  await expect
    .poll(() => selectedIds(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toHaveLength(4);
  await expect(lee.page.getByTestId('selection-count')).toHaveText('4 selected');

  // Sam deletes one of them. Lee does not have to notice anything: the selection is
  // kept honest about what the board still holds.
  const gone = ids[1]!;
  await select(sam.page, [gone]);
  await sam.page.keyboard.press('Delete');

  await expect
    .poll(() => selectedIds(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toEqual([ids[0]!, ids[2]!, ids[3]!]);
  await expect(lee.page.getByTestId('selection-count')).toHaveText('3 selected');
  await expect(lee.page.locator(`[data-note-id="${gone}"]`)).toHaveCount(0);
  // The outline is still there, now around the three that are left, and Sam's screen
  // is quiet: a delete does not hand anybody else a selection.
  await expect(lee.page.locator('[data-testid="selection-overlay"]')).toHaveCount(1);
  expect(await selectedIds(sam.page)).toEqual([]);

  // And Lee's selection still works: one key removes exactly the three left standing.
  await lee.page.keyboard.press('Delete');
  await expect
    .poll(() => getNotes(lee.page).then((notes) => notes.map((n) => n.id)), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toEqual([]);
  expect(await selectedIds(lee.page)).toEqual([]);
  await expect(sam.page.locator('[data-note-id]')).toHaveCount(0);
  expect(lee.errors).toEqual([]);
  expect(sam.errors).toEqual([]);
});

test('TC-36: people moving different selections at once end on the same board', async ({
  liveBoards,
}) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor${i + 1}`);
  const { people } = await liveBoards.open(names);
  for (const person of people) await setCamera(person.page, FLAT);

  // Two notes each, one pair per person, far enough apart that nobody's drag crosses
  // into somebody else's notes.
  const pairs: string[][] = [];
  for (let i = 0; i < people.length; i += 1) {
    const x = 100 + i * (NOTE + 60);
    pairs.push([await seedAt(people[0]!.page, x, 200), await seedAt(people[0]!.page, x, 460)]);
  }
  await expect
    .poll(async () => (await getNotes(people[people.length - 1]!.page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(pairs.length * 2);

  // Everyone selects their own pair and drags it, all at the same time.
  await Promise.all(
    people.map(async (person, i) => {
      const [a, b] = pairs[i]!;
      await select(person.page, [a!, b!]);
      const grab = await centre(person.page, a!);
      const offset = 40 + i * 20;
      await drag(person.page, grab, { x: grab.x + offset, y: grab.y + offset });
    }),
  );

  // One board: every screen agrees on where every note ended up, and every note moved
  // by exactly the amount its own person dragged it.
  const expected = await notesById(people[0]!.page);
  for (const person of people) {
    await expect
      .poll(async () => JSON.stringify(await notesById(person.page)), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(JSON.stringify(expected));
  }
  for (let i = 0; i < pairs.length; i += 1) {
    const offset = 40 + i * 20;
    const [a, b] = pairs[i]!;
    expect(placed(expected[a]).x).toBe(100 + i * (NOTE + 60) + offset);
    expect(placed(expected[a]).y).toBe(200 + offset);
    // Its partner moved by exactly the same amount, because it was in that selection.
    expect(placed(expected[b]).x - placed(expected[a]).x).toBe(0);
    expect(placed(expected[b]).y - placed(expected[a]).y).toBe(260);
  }
  for (const person of people) expect(person.errors).toEqual([]);
});
