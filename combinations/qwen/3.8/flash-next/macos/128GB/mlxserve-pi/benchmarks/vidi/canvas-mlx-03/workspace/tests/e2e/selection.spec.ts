// Story 7 e2e: selecting, moving, resizing and deleting several objects at once,
// against the real client served by wrangler dev.
//
// Everything is measured from the DOM rather than assumed: `rects()` returns both
// each note's world position (its own style) and its screen rectangle (its bounding
// box), and `zoomOf()` reads the zoom back from a note's two widths. The drags are
// then honest — the pointer goes where a user would put it, and the expected world
// deltas are computed from the zoom actually on screen.
import { test, expect, type Page } from '@playwright/test';
import {
  ensureBoard,
  openSharedBoard,
  setCamera,
  noteCount,
  noteIds,
} from './helpers/board.ts';
import { RawClient } from './helpers/rawClient.ts';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config.ts';

interface NoteRect {
  id: string;
  text: string;
  x: number; // world left
  y: number; // world top
  w: number; // world width
  h: number; // world height
  z: number;
  left: number; // screen box
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

interface Point {
  x: number;
  y: number;
}

const settle = (page: Page) => page.waitForTimeout(60);

async function rects(page: Page): Promise<NoteRect[]> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]'),
    ) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      const label = el.querySelector('[data-testid="sticky-text"]');
      return {
        id: el.dataset.noteId ?? '',
        text: (label?.textContent ?? '').trim(),
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
        z: parseFloat(el.style.zIndex),
        left: r.x,
        top: r.y,
        right: r.x + r.width,
        bottom: r.y + r.height,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
  });
}

const byText = (list: NoteRect[], text: string): NoteRect => {
  const hit = list.find((n) => n.text === text);
  if (!hit) throw new Error(`no note labelled "${text}" on this board`);
  return hit;
};

/** Zoom, read back as (screen width / world width) of the first note. */
async function zoomOf(page: Page): Promise<number> {
  const z = await page.evaluate(() => {
    const el = document.querySelector(
      '[role="group"][aria-label="Sticky note"]',
    ) as HTMLElement | null;
    if (!el) return null;
    const world = parseFloat(el.style.width);
    return world > 0 ? el.getBoundingClientRect().width / world : null;
  });
  if (z === null) throw new Error('no note on the board to measure the zoom with');
  return z;
}

async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-selected="true"]'))
      .map(
        (el) =>
          (el as HTMLElement).dataset.noteId ?? (el as HTMLElement).dataset.objectId ?? '',
      )
      .filter((s) => s !== '')
      .sort(),
  );
}

/** The bar's count, read from the label itself (the bar also holds a 🗑 button). */
async function barText(page: Page): Promise<string | null> {
  const count = page.getByTestId('selection-count');
  if ((await count.count()) === 0) return null;
  return ((await count.textContent()) ?? '').trim();
}

/**
 * Where every note is and how it stacks, as one string. Camera-independent, so two
 * screens can be compared even if their viewports differ.
 */
function positionSignature(list: NoteRect[]): string {
  return [...list]
    .map((n) => `${n.text}:${Math.round(n.x)},${Math.round(n.y)},${n.z}`)
    .sort()
    .join('|');
}

/** Assert another collaborator's screen agrees with `reference`, in time. */
async function expectAgrees(page: Page, reference: NoteRect[]) {
  const wanted = positionSignature(reference);
  await expect
    .poll(() => rects(page).then(positionSignature), {
      timeout: 4 * LIVE_UPDATE_LATENCY_BUDGET_MS,
    })
    .toBe(wanted);
}

async function liveText(page: Page): Promise<string> {
  return ((await page.getByTestId('selection-live').textContent()) ?? '').trim();
}

/** Shift+drag across empty space: marquee selection. */
async function marquee(page: Page, from: Point, to: Point) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** A plain drag: moves what the pointer landed on, plus the rest of its selection. */
async function drag(page: Page, from: Point, dxPx: number, dyPx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(from.x + dxPx / 3, from.y + dyPx / 3, { steps: 5 });
  await page.waitForTimeout(20);
  await page.mouse.move(from.x + (2 * dxPx) / 3, from.y + (2 * dyPx) / 3, { steps: 5 });
  await page.waitForTimeout(20);
  await page.mouse.move(from.x + dxPx, from.y + dyPx, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

/** A click on an object: selects it and nothing else. */
async function click(page: Page, at: Point) {
  await drag(page, at, 0, 0);
}

/** Select notes with a marquee drawn around their own on-screen boxes. */
async function marqueeOver(page: Page, list: NoteRect[], margin = 6) {
  const left = Math.min(...list.map((n) => n.left)) - margin;
  const top = Math.min(...list.map((n) => n.top)) - margin;
  const right = Math.max(...list.map((n) => n.right)) + margin;
  const bottom = Math.max(...list.map((n) => n.bottom)) + margin;
  await marquee(page, { x: left, y: top }, { x: right, y: bottom });
}

/** The on-screen selection rectangle, in CSS pixels. */
async function selectionBoxRect(page: Page) {
  const box = await page.getByTestId('selection-box').boundingBox();
  if (!box) throw new Error('selection box not rendered');
  return box;
}

/** The gap between two neighbouring columns of notes, in world units. */
function hGap(list: NoteRect[]): number {
  const lefts = [...new Set(list.map((n) => Math.round(n.x)))].sort((a, b) => a - b);
  return lefts[1]! - lefts[0]! - list[0]!.w;
}

const lowest = (list: NoteRect[]) =>
  list.reduce((a, b) => (a.right + a.bottom > b.right + b.bottom ? a : b));

/** Seed notes onto a board with a Node-side collaborator (fast, no UI). */
async function seedNotes(
  boardId: string,
  notes: { text: string; x: number; y: number }[],
): Promise<void> {
  const client = new RawClient(boardId);
  await client.connect();
  await client.waitFor(() => client.noteCount() === 0);
  for (const n of notes) client.addSticky({ text: n.text, x: n.x, y: n.y, color: 'yellow' });
  await client.waitFor(() => client.noteCount() === notes.length);
  client.close();
}

/**
 * The 20-note fixture: a 5 x 4 grid, notes touching at 200 world units, centred so
 * that at 60% zoom the whole board sits inside a 1280 x 800 screen.
 */
function grid20() {
  const out: { text: string; x: number; y: number }[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      out.push({
        text: `n${String(row * 5 + col + 1).padStart(2, '0')}`,
        x: 300 + col * 200,
        y: 160 + row * 200,
      });
    }
  }
  return out;
}

/** A 3 x 2 cluster of notes, plus optionally one more somewhere else. */
function cluster6(prefix: string, dx = 0, dy = 0) {
  const out: { text: string; x: number; y: number }[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      out.push({ text: `${prefix}${row}${col}`, x: 300 + col * 220 + dx, y: 200 + row * 220 + dy });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// TC-32 marquee selection
// ---------------------------------------------------------------------------

test.describe('TC-32 marquee selection', () => {
  test('only what the box fully encloses is selected', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [
      { text: 'A', x: 400, y: 300 }, // fully inside the box
      { text: 'B', x: 700, y: 300 }, // half outside it, on the right
      { text: 'C', x: 400, y: 700 }, // well outside it, below
    ]);
    const lee = await context.newPage();
    const sam = await context.newPage();
    await openSharedBoard(lee, id);
    await openSharedBoard(sam, id);
    await expect.poll(() => noteCount(lee)).toBe(3);

    const before = await rects(lee);
    const A = byText(before, 'A');
    const B = byText(before, 'B');
    expect(B.right).toBeGreaterThan(A.right); // the layout this case describes

    // A box ending halfway between the two notes' right edges: A is inside, B is
    // half outside, C is outside below.
    const edge = (A.right + B.left) / 2 + 20;
    await marquee(lee, { x: A.left - 40, y: A.top - 40 }, { x: edge, y: A.bottom + 40 });
    expect(await selectedIds(lee)).toEqual([A.id]);
    // One object selected: its own toolbar, never the multi-select bar.
    await expect(lee.getByTestId('note-toolbar')).toBeVisible();
    await expect(lee.getByTestId('selection-bar')).toHaveCount(0);
    // Nothing moved: selecting is not an edit.
    expect(await rects(lee)).toEqual(before);

    // Widening the box over B adds it, and the bar appears with the count.
    await marquee(lee, { x: A.left - 40, y: A.top - 40 }, { x: B.right + 30, y: A.bottom + 40 });
    expect((await selectedIds(lee)).sort()).toEqual([A.id, B.id].sort());
    expect(await barText(lee)).toBe('2 selected');
    expect(await liveText(lee)).toBe('2 selected');

    // Selection belongs to one collaborator: Sam sees no outline, no bar, no box.
    expect(await selectedIds(sam)).toEqual([]);
    await expect(sam.getByTestId('selection-bar')).toHaveCount(0);
    await expect(sam.getByTestId('selection-box')).toHaveCount(0);

    // Escape clears the selection.
    await lee.keyboard.press('Escape');
    await settle(lee);
    expect(await selectedIds(lee)).toEqual([]);
    expect(await liveText(lee)).toBe('');
    await lee.close();
    await sam.close();
  });

  test('a box that catches nothing leaves the selection as it was', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [
      { text: 'A', x: 400, y: 300 },
      { text: 'B', x: 900, y: 600 },
    ]);
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(2);
    const A = byText(await rects(page), 'A');
    await click(page, { x: A.cx, y: A.cy });
    expect(await selectedIds(page)).toEqual([A.id]);
    // An empty corner of the board, dragged backwards.
    await marquee(page, { x: 260, y: 760 }, { x: 60, y: 620 });
    expect(await selectedIds(page)).toEqual([A.id]);
    // And a marquee that does catch the other note adds it, keeping A.
    const B = byText(await rects(page), 'B');
    await marqueeOver(page, [B], 6);
    expect((await selectedIds(page)).sort()).toEqual([A.id, B.id].sort());
    await page.close();
  });

  test('Escape while the box is still held cancels it', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [
      { text: 'A', x: 400, y: 300 },
      { text: 'B', x: 900, y: 300 },
    ]);
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(2);
    const A = byText(await rects(page), 'A');
    const B = byText(await rects(page), 'B');
    await click(page, { x: A.cx, y: A.cy });
    await page.keyboard.down('Shift');
    await page.mouse.move(60, 620);
    await page.mouse.down();
    await page.mouse.move(B.right + 20, B.bottom + 20, { steps: 8 });
    await expect(page.getByTestId('marquee-rect')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('marquee-rect')).toHaveCount(0);
    // A is still selected; B never was.
    expect(await selectedIds(page)).toEqual([A.id]);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual([A.id]);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// TC-33 group move and group resize
// ---------------------------------------------------------------------------

test.describe('TC-33 transform a group', () => {
  test('moving one note moves all six and puts them above the note left behind', async ({
    context,
  }) => {
    const id = await ensureBoard();
    await seedNotes(id, [...cluster6('c'), { text: 'top', x: 1150, y: 300 }]);
    const lee = await context.newPage();
    const sam = await context.newPage();
    await openSharedBoard(lee, id);
    await openSharedBoard(sam, id);
    await expect.poll(() => noteCount(lee)).toBe(7);

    let all = await rects(lee);
    const six = all.filter((n) => n.text !== 'top');
    const top = byText(all, 'top');
    expect(six).toHaveLength(6);
    expect(Math.max(...six.map((n) => n.z))).toBeLessThan(top.z);

    await marqueeOver(lee, six);
    expect(await barText(lee)).toBe('6 selected');

    const before = await rects(lee);
    const moving = before.filter((n) => n.text !== 'top');
    const grabbed = byText(moving, 'c00');
    const zoom = await zoomOf(lee);
    await drag(lee, { x: grabbed.cx, y: grabbed.cy }, 300 * zoom, 0);

    const after = await rects(lee);
    const topAfter = byText(after, 'top');
    for (const n of after.filter((x) => x.text !== 'top')) {
      const was = moving.find((m) => m.id === n.id)!;
      // Every note travelled the same 300 world units, and nothing else changed.
      expect(n.x - was.x).toBeCloseTo(300, 0);
      expect(n.y).toBeCloseTo(was.y, 0);
      expect(n.w).toBeCloseTo(STICKY_SIZE_WORLD, 0);
      // The whole group is now drawn above the note that stayed behind.
      expect(n.z).toBeGreaterThan(topAfter.z);
      expect(n.z).toBeGreaterThan(was.z);
    }
    // The note that was not selected kept its place and its stacking order.
    expect(topAfter.x).toBeCloseTo(top.x, 0);
    expect(topAfter.z).toBe(top.z);
    // Still six selected, still one gesture's worth of state.
    expect((await selectedIds(lee)).length).toBe(6);
    expect(await barText(lee)).toBe('6 selected');
    // And Sam sees the same seven notes at the same places, same stacking.
    await expectAgrees(sam, after);
    await lee.close();
    await sam.close();
  });

  test('resizing the group scales every note, its gaps, and keeps notes square', async ({
    context,
  }) => {
    const id = await ensureBoard();
    await seedNotes(id, cluster6('r'));
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(6);

    await marqueeOver(page, await rects(page));
    expect(await barText(page)).toBe('6 selected');
    const zoom = await zoomOf(page);

    const before = await rects(page);
    const boxBefore = await selectionBoxRect(page);
    const gapBefore = hGap(before);
    expect(gapBefore).toBeCloseTo(20, 0);
    const se = lowest(before);

    // Grow the group 60 px at the current zoom through its bottom-right handle.
    await drag(page, { x: se.right - 1, y: se.bottom - 1 }, 60, 60);
    const grown = await rects(page);
    const boxGrown = await selectionBoxRect(page);
    const f = boxGrown.width / boxBefore.width;
    expect(f).toBeGreaterThan(1.05);
    expect(f).toBeLessThan(1.3);
    for (const n of grown) {
      // Each note scaled by the same factor as the box, and stayed square.
      expect(n.w).toBeCloseTo(STICKY_SIZE_WORLD * f, 0);
      expect(n.h).toBeCloseTo(n.w, 0);
    }
    // The gaps travelled with it, so the layout held instead of piling up.
    expect(hGap(grown)).toBeCloseTo(gapBefore * f, 0);
    // The corner that was not dragged stayed where it was.
    const nw = byText(grown, 'r00');
    const nwBefore = byText(before, 'r00');
    expect(nw.x).toBeCloseTo(nwBefore.x, 0);
    expect(nw.y).toBeCloseTo(nwBefore.y, 0);

    // Now shrink it far: notes stop at their minimum instead of turning inside out.
    const grownList = await rects(page);
    const grownSe = lowest(grownList);
    const grownNw = byText(grownList, 'r00');
    await drag(
      page,
      { x: grownSe.right - 1, y: grownSe.bottom - 1 },
      (grownNw.left - grownSe.right) * zoom,
      (grownNw.top - grownSe.bottom) * zoom,
    );
    const small = await rects(page);
    for (const n of small) {
      expect(n.w).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
      expect(n.h).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
      expect(n.z).toBeGreaterThan(0);
    }
    // The group is still selected and still six notes.
    expect((await selectedIds(page)).length).toBe(6);
    expect(await barText(page)).toBe('6 selected');
    await page.close();
  });

  test('one selected note still gets its own toolbar, not the bar', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [
      { text: 'A', x: 400, y: 300 },
      { text: 'B', x: 700, y: 300 },
    ]);
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(2);
    const all = await rects(page);
    await marqueeOver(page, all);
    expect(await barText(page)).toBe('2 selected');
    // Pressing one note of the selection keeps the group: a press is meant for
    // dragging the group, not for dropping the selection.
    const B = byText(all, 'B');
    await click(page, { x: B.cx, y: B.cy });
    expect((await selectedIds(page)).sort()).toEqual([byText(all, 'A').id, B.id].sort());
    await page.keyboard.press('Escape');
    expect(await selectedIds(page)).toEqual([]);
    // Clicking one note alone: the note's own toolbar, and no bar.
    await click(page, { x: B.cx, y: B.cy });
    expect(await selectedIds(page)).toEqual([B.id]);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// TC-34 keyboard commands
// ---------------------------------------------------------------------------

test.describe('TC-34 selection keyboard commands', () => {
  test('select all, nudge without scrolling or panning, then delete', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [...cluster6('k'), { text: 'extra', x: 1150, y: 620 }]);
    const lee = await context.newPage();
    const sam = await context.newPage();
    await openSharedBoard(lee, id);
    await openSharedBoard(sam, id);
    await expect.poll(() => noteCount(lee)).toBe(7);

    await lee.keyboard.press('Control+a');
    await settle(lee);
    const start = await rects(lee);
    expect(start).toHaveLength(7);
    expect((await selectedIds(lee)).sort()).toEqual(start.map((n) => n.id).sort());
    expect(await liveText(lee)).toBe('7 selected');
    // Sam is not dragged into Lee's selection.
    expect(await selectedIds(sam)).toEqual([]);

    const cameraOf = (page: Page) =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('[data-testid="world-layer"]')!).transform,
      );
    const cameraBefore = await cameraOf(lee);
    const expected = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;

    for (let i = 0; i < 3; i++) {
      await lee.keyboard.press('ArrowRight');
      await settle(lee);
    }
    const stepped = await rects(lee);
    for (const n of stepped) {
      expect(n.x - byText(start, n.text).x).toBeCloseTo(3 * NUDGE_STEP_WORLD, 3);
    }
    await lee.keyboard.press('Shift+ArrowRight');
    await settle(lee);
    const nudged = await rects(lee);
    for (const n of nudged) {
      expect(n.x - byText(start, n.text).x).toBeCloseTo(expected, 3);
      expect(n.y).toBeCloseTo(byText(start, n.text).y, 3);
    }
    // The keystrokes went to the board: no page scroll, no camera pan.
    expect(await lee.evaluate(() => window.scrollY)).toBe(0);
    expect(await cameraOf(lee)).toBe(cameraBefore);
    // Sam sees the same nudge within the latency budget.
    await expectAgrees(sam, nudged);

    await lee.keyboard.press('Delete');
    await settle(lee);
    await expect.poll(() => noteCount(lee)).toBe(0);
    await expect.poll(() => noteIds(sam)).toEqual([]);
    expect(await selectedIds(lee)).toEqual([]);
    await expect(lee.getByTestId('selection-bar')).toHaveCount(0);
    await expect(lee.getByTestId('selection-box')).toHaveCount(0);
    await lee.close();
    await sam.close();
  });

  test('keys with nothing selected change nothing', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, [{ text: 'lonely', x: 400, y: 300 }]);
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(1);
    const before = await rects(page);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    await settle(page);
    expect(await rects(page)).toEqual(before);
    // And we are still on the board: a stray Backspace does not take the browser
    // back out of it.
    expect(page.url()).toContain(`/b/${id}`);
    // Escape with nothing selected is not an error either.
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await noteCount(page)).toBe(1);
    await page.close();
  });

  test('typing in a note steals the keys from the board', async ({ context }) => {
    const id = await ensureBoard();
    await seedNotes(id, cluster6('t'));
    const page = await context.newPage();
    await openSharedBoard(page, id);
    await expect.poll(() => noteCount(page)).toBe(6);
    const before = await rects(page);
    // Edit one note's text: the board's keys must go silent.
    const one = byText(before, 't00');
    await click(page, { x: one.cx, y: one.cy });
    await page.keyboard.press('Enter');
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toBeVisible();
    await page.keyboard.type('hi');
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toHaveValue('t00hi');
    // The board's own arrow keys, pressed while the text has focus: they move the
    // caret, not the notes.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toHaveValue('t00hi');
    // Backspace eats a character of the text instead of deleting the selection.
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toHaveValue('t00h');
    // Select-all inside the text does not reach the board either.
    await page.keyboard.press('Control+a');
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toHaveValue('t00h');
    expect(await barText(page)).toBeNull();
    expect((await selectedIds(page)).sort()).toEqual([one.id]);
    // Nothing moved: those keys belonged to the text, and all six notes are here.
    await page.keyboard.press('Escape');
    await settle(page);
    const after = await rects(page);
    expect(after).toHaveLength(6);
    const beforeById = new Map(before.map((n) => [n.id, n]));
    for (const n of after) {
      const was = beforeById.get(n.id)!;
      expect(n.x).toBeCloseTo(was.x, 0);
      expect(n.y).toBeCloseTo(was.y, 0);
    }
    // The only thing that changed is the one note's text.
    expect(after.map((n) => n.text).sort()).toEqual([
      't00h',
      't01',
      't02',
      't10',
      't11',
      't12',
    ]);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// TC-35 a colleague deletes one of my selected notes
// ---------------------------------------------------------------------------

test.describe('TC-35 selection pruned by a remote delete', () => {
  test('the bar follows the document while the rest stays selected', async ({ browser }) => {
    const id = await ensureBoard();
    await seedNotes(id, grid20());

    // Two collaborators, each in their own browser context.
    const leeCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const samCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const lee = await leeCtx.newPage();
    const sam = await samCtx.newPage();
    await openSharedBoard(lee, id);
    await openSharedBoard(sam, id);
    await expect.poll(() => noteCount(lee)).toBe(20);
    // The fixture is 20 notes of 200 units in a 5 x 4 grid; at 60% it fits a screen.
    await setCamera(lee, { x: 0, y: 0, zoom: 0.6 });
    await setCamera(sam, { x: 0, y: 0, zoom: 0.6 });
    await settle(lee);
    await settle(sam);

    // Lee Shift+drags a box over four notes of the top two rows.
    const leeNotes = await rects(lee);
    const four = ['n01', 'n02', 'n06', 'n07'].map((t) => byText(leeNotes, t));
    await marqueeOver(lee, four, 4);
    expect(await barText(lee)).toBe('4 selected');
    expect((await selectedIds(lee)).sort()).toEqual(four.map((n) => n.id).sort());

    // Sam selects one of those four and deletes it.
    const doomedText = 'n07';
    const samDoomed = byText(await rects(sam), doomedText);
    await click(sam, { x: samDoomed.cx, y: samDoomed.cy });
    expect(await selectedIds(sam)).toEqual([samDoomed.id]);
    await sam.keyboard.press('Delete');
    await settle(sam);
    await expect.poll(() => noteCount(sam)).toBe(19);

    // On Lee's screen, within the latency budget: the note is gone, the bar counts
    // the survivors, and the outlines are the three that remain.
    const survivors = four.filter((n) => n.text !== doomedText).map((n) => n.id).sort();
    await expect
      .poll(() => barText(lee), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe('3 selected');
    expect(await selectedIds(lee)).toEqual(survivors);
    expect(await rects(lee)).toHaveLength(19);
    expect(await liveText(lee)).toBe('3 selected');

    // One Delete on Lee's side removes exactly those three, and no more.
    await lee.keyboard.press('Delete');
    await settle(lee);
    await expect.poll(() => noteCount(lee)).toBe(16);
    expect(await noteCount(sam)).toBe(16);
    expect(await selectedIds(lee)).toEqual([]);
    await expect(lee.getByTestId('selection-bar')).toHaveCount(0);
    await expect(lee.getByTestId('selection-box')).toHaveCount(0);
    await leeCtx.close();
    await samCtx.close();
  });

  test('a remote delete of the whole selection empties it', async ({ browser }) => {
    const id = await ensureBoard();
    await seedNotes(id, cluster6('x'));
    const leeCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const samCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const lee = await leeCtx.newPage();
    const sam = await samCtx.newPage();
    await openSharedBoard(lee, id);
    await openSharedBoard(sam, id);
    await expect.poll(() => noteCount(lee)).toBe(6);

    await marqueeOver(lee, await rects(lee));
    expect(await barText(lee)).toBe('6 selected');

    // Sam selects all six and deletes them.
    await sam.keyboard.press('Control+a');
    await settle(sam);
    await sam.keyboard.press('Delete');
    await settle(sam);
    await expect.poll(() => noteCount(lee)).toBe(0);
    expect(await selectedIds(lee)).toEqual([]);
    await expect(lee.getByTestId('selection-bar')).toHaveCount(0);
    expect(await liveText(lee)).toBe('');
    // Nothing left for Lee's Delete to do.
    await lee.keyboard.press('Delete');
    await settle(lee);
    expect(await noteCount(lee)).toBe(0);
    await leeCtx.close();
    await samCtx.close();
  });
});

// ---------------------------------------------------------------------------
// TC-36 full-capacity reorganisation
// ---------------------------------------------------------------------------

test.describe('TC-36 full-capacity reorganisation', () => {
  test(`${MAX_CONCURRENT_EDITORS} collaborators each move a different group at once`, async ({
    context,
  }) => {
    const id = await ensureBoard();
    await seedNotes(id, grid20());

    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const page = await context.newPage();
      await openSharedBoard(page, id);
      pages.push(page);
    }
    for (const page of pages) {
      await expect.poll(() => noteCount(page)).toBe(20);
      await setCamera(page, { x: 0, y: 0, zoom: 0.6 });
    }

    // Each collaborator selects one column of the grid and pulls it down by a
    // different distance: five selections, five drags, all in flight together.
    const zoom = 0.6;
    const columns: NoteRect[][] = [];
    const dropsPx: number[] = [];
    for (const [i, page] of pages.entries()) {
      const col = (await rects(page)).filter((n) => Math.abs(n.x - (200 + i * 200)) < 2);
      expect(col).toHaveLength(4);
      await marqueeOver(page, col, 4);
      expect(await barText(page)).toBe('4 selected');
      columns.push(col);
      dropsPx.push(40 * (i + 1));
    }

    const start = await rects(pages[0]!);
    await Promise.all(
      pages.map(async (page, i) => {
        const grabbed = columns[i]![0]!;
        await drag(page, { x: grabbed.cx, y: grabbed.cy }, 0, dropsPx[i]!);
      }),
    );

    // Absolute writes: however the updates interleaved, every client must land on
    // the same document.
    const expected = new Map<string, number>();
    for (const n of start) expected.set(n.id, n.y);
    for (const [i, col] of columns.entries()) {
      for (const n of col) {
        expected.set(n.id, byText(start, n.text).y + dropsPx[i]! / zoom);
      }
    }
    const signature = (list: { id: string; y: number }[]) =>
      [...list].map((n) => `${n.id}:${Math.round(n.y)}`).sort().join(',');
    const wanted = signature([...expected.entries()].map(([id, y]) => ({ id, y })));

    for (const page of pages) {
      await expect
        .poll(() => rects(page).then((r) => signature(r)), {
          timeout: 4 * LIVE_UPDATE_LATENCY_BUDGET_MS,
        })
        .toBe(wanted);
    }
    // Nothing was lost, and no two screens disagree about where anything is.
    const screens = await Promise.all(pages.map((p) => rects(p)));
    for (const screen of screens) {
      expect(screen).toHaveLength(20);
      for (const n of screen) {
        expect(n.y).toBeCloseTo(expected.get(n.id)!, 0);
      }
    }
    for (const page of pages) await page.close();
  });
});
