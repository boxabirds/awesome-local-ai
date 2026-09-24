import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  SELECTION_CLUSTER_X,
  SELECTION_CLUSTER_Y,
  SELECTION_RETRO_NOTES,
  selectionRetroBoard,
} from '../fixtures/boards';
import { getCamera, getNotes, nextFrames, noteLocator, setCamera, type CameraState, type NoteState } from './helpers/board';
import { closeParticipants, expectWithin, openParticipants, waitConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';

/**
 * Story 7 e2e (sel.marquee_ui, sel.transform, sel.keyboard, sel.interaction) on the 20-note retro
 * board: two clusters of 2 rows × 5 notes, neighbours 150 units apart (notes overlap).
 */

/** Cluster 1 fills the left of the screen at 100%. */
const CAMERA: CameraState = { x: SELECTION_CLUSTER_X[0] - 100, y: SELECTION_CLUSTER_Y - 100, zoom: 1 };
const SPACING = 150;
const COLUMNS = 5;
const NOTE = STICKY_SIZE_WORLD;
const MARGIN = 10;
const MOVE_WORLD = 300;
const DRAG_STEPS = 10;
/** Grab point inside a row-0 note that no other note covers: left part, top part. */
const GRAB_OFFSET = { x: 50, y: 50 } as const;
const RESIZE_FACTOR = 1.5;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Decimal places for float comparisons after scaling. */
const CLOSE = 6;
const HALF = 2;
/** TC-36: person i drags by (±(BASE_DX + i·STEP_DX), BASE_DY + i·STEP_DY) world units. */
const BASE_DX = 40;
const STEP_DX = 10;
const BASE_DY = 420;
const STEP_DY = 30;
/** An empty spot of the board (screen px) right of cluster 1. */
const EMPTY_SPOT = { x: 1000, y: 700 } as const;
/** ArrowRight presses in TC-34. */
const SMALL_NUDGES = 3;

interface Pt {
  x: number;
  y: number;
}

/** Top-left (world) of cluster 1's note in `row`, `column`. */
function slot(row: number, column: number): Pt {
  return { x: SELECTION_CLUSTER_X[0] + column * SPACING, y: SELECTION_CLUSTER_Y + row * SPACING };
}

function toScreen(p: Pt, cam: CameraState = CAMERA): Pt {
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

/** Notes of cluster 1 by (row, column): the fixture creates them in this order. */
async function clusterIds(page: Page): Promise<string[][]> {
  const notes = await getNotes(page);
  const at = (p: Pt) => notes.find((n) => n.x === p.x && n.y === p.y)?.id;
  return [0, 1].map((row) =>
    Array.from({ length: COLUMNS }, (_, column) => {
      const id = at(slot(row, column));
      if (!id) throw new Error(`no note at row ${row} column ${column}`);
      return id;
    }),
  );
}

async function openSeededBoard(page: Page, baseURL: string): Promise<string> {
  const boardId = newBoardId();
  await seedBoard(baseURL, boardId, selectionRetroBoard());
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await waitConnected(page);
  await expect(noteLocator(page)).toHaveCount(SELECTION_RETRO_NOTES);
  await setCamera(page, CAMERA);
  await nextFrames(page);
  return boardId;
}

async function selectionOf(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6!.getSelection().sort());
}

function selectionBar(page: Page) {
  return page.getByRole('toolbar', { name: 'Selection' });
}

/** Shift+drag from world `from` (empty board) to world `to`; checks the rectangle mid-drag. */
async function marquee(page: Page, from: Pt, to: Pt, cam: CameraState = CAMERA): Promise<void> {
  const a = toScreen(from, cam);
  const b = toScreen(to, cam);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / HALF, (a.y + b.y) / HALF, { steps: DRAG_STEPS });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.move(b.x, b.y, { steps: DRAG_STEPS });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('marquee')).toHaveCount(0);
}

async function dragBy(page: Page, from: Pt, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: DRAG_STEPS });
  await page.mouse.up();
  await nextFrames(page);
}

async function centreOf(page: Page, name: string): Promise<Pt> {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox();
  if (!box) throw new Error(`${name} not rendered`);
  return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
}

function byId(notes: NoteState[], id: string): NoteState & { width?: number; height?: number } {
  const n = notes.find((x) => x.id === id);
  if (!n) throw new Error(`note ${id} missing`);
  return n;
}

test.describe('Workflow: reorganise a cluster', () => {
  test('TC-32 Shift+drag: A fully inside is selected, B half inside and C outside are not', async ({ page, baseURL }) => {
    await openSeededBoard(page, baseURL!);
    const [row0] = await clusterIds(page);
    const [a, b, , , c] = row0!;
    // Rectangle around A (row 0, column 0); B (column 1) starts 150 units in, so it is partly
    // inside (as is the row-1 note below A); C (column 4) is outside.
    await marquee(
      page,
      { x: slot(0, 0).x - MARGIN, y: slot(0, 0).y - MARGIN },
      { x: slot(0, 0).x + NOTE + MARGIN, y: slot(0, 0).y + NOTE + MARGIN },
    );
    expect(await selectionOf(page)).toEqual([a]);
    await expect(noteLocator(page, a!)).toHaveAttribute('data-selected', 'true');
    await expect(noteLocator(page, b!)).toHaveAttribute('data-selected', 'false');
    await expect(noteLocator(page, c!)).toHaveAttribute('data-selected', 'false');
    // One sticky selected: the note toolbar, not the bar.
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();
  });

  test('TC-33 → TC-34 box-select 6, move together above a 4th, resize, nudge, delete', async ({ page, baseURL }) => {
    await openSeededBoard(page, baseURL!);
    const [row0, row1] = await clusterIds(page);
    const six = [row0![0]!, row0![1]!, row0![2]!, row1![0]!, row1![1]!, row1![2]!];
    const fourth = row0![3]!;
    // TC-33: select the 6 (columns 0–2 of both rows) with one rectangle.
    await marquee(
      page,
      { x: slot(0, 0).x - MARGIN, y: slot(0, 0).y - MARGIN },
      { x: slot(1, 2).x + NOTE + MARGIN, y: slot(1, 2).y + NOTE + MARGIN },
    );
    expect(await selectionOf(page)).toEqual([...six].sort());
    await expect(selectionBar(page)).toContainText('6 selected');
    await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible();
    for (const label of ['Resize top-left', 'Resize bottom-right', 'Resize right', 'Resize bottom']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    const before = await getNotes(page);
    const zOrderBefore = before.filter((n) => six.includes(n.id)).map((n) => n.id);
    // Drag the first note 300 units right: over the unselected 4th note (column 3).
    await dragBy(page, toScreen({ x: slot(0, 0).x + GRAB_OFFSET.x, y: slot(0, 0).y + GRAB_OFFSET.y }), MOVE_WORLD, 0);
    const moved = await getNotes(page);
    for (const id of six) {
      expect(byId(moved, id).x).toBe(byId(before, id).x + MOVE_WORLD);
      expect(byId(moved, id).y).toBe(byId(before, id).y);
    }
    const unselectedTop = Math.max(...moved.filter((n) => !six.includes(n.id)).map((n) => n.z));
    for (const id of six) expect(byId(moved, id).z).toBeGreaterThan(unselectedTop);
    expect(moved.filter((n) => six.includes(n.id)).map((n) => n.id)).toEqual(zOrderBefore);
    // On screen, the moved group covers the 4th note where they overlap.
    const overlap = toScreen({ x: slot(0, 3).x + GRAB_OFFSET.x, y: slot(0, 3).y + GRAB_OFFSET.y });
    const topId = await page.evaluate(
      (p) => document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('[data-id]')?.dataset.id,
      overlap,
    );
    expect(six).toContain(topId);
    expect(topId).not.toBe(fourth);

    // Corner resize: the bottom-right handle outward by half the box → everything × 1.5.
    const boxBefore = await page.getByTestId('selection-box').boundingBox();
    const se = await centreOf(page, 'Resize bottom-right');
    await dragBy(page, se, boxBefore!.width * (RESIZE_FACTOR - 1), boxBefore!.height * (RESIZE_FACTOR - 1));
    const grown = await getNotes(page);
    const origin = { x: slot(0, 0).x + MOVE_WORLD, y: slot(0, 0).y };
    for (const id of six) {
      const n = byId(grown, id);
      const m = byId(moved, id);
      expect(n.width).toBeCloseTo(NOTE * RESIZE_FACTOR, 0);
      expect(n.height).toBe(n.width);
      expect(n.x - origin.x).toBeCloseTo((m.x - origin.x) * RESIZE_FACTOR, 0);
      expect(n.y - origin.y).toBeCloseTo((m.y - origin.y) * RESIZE_FACTOR, 0);
      const box = await noteLocator(page, id).boundingBox();
      expect(box!.width).toBeCloseTo(NOTE * RESIZE_FACTOR, 0);
      expect(box!.height).toBeCloseTo(box!.width, 0);
    }
    // Shrinking far past the limit stops every note at STICKY_MIN_SIZE_WORLD.
    const boxNow = await page.getByTestId('selection-box').boundingBox();
    const se2 = await centreOf(page, 'Resize bottom-right');
    await dragBy(page, se2, boxNow!.x + MARGIN - se2.x, boxNow!.y + MARGIN - se2.y);
    const shrunk = await getNotes(page);
    for (const id of six) {
      expect(byId(shrunk, id).width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, CLOSE);
      expect(byId(shrunk, id).height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, CLOSE);
    }

    // TC-34: arrows nudge without scrolling the page or panning the board.
    const camBefore = await getCamera(page);
    for (let i = 0; i < SMALL_NUDGES; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    await nextFrames(page);
    const nudged = await getNotes(page);
    for (const id of six) {
      expect(byId(nudged, id).x).toBeCloseTo(byId(shrunk, id).x + NUDGE_STEP_WORLD * SMALL_NUDGES + NUDGE_LARGE_STEP_WORLD, CLOSE);
      expect(byId(nudged, id).y).toBeCloseTo(byId(shrunk, id).y + NUDGE_STEP_WORLD, CLOSE);
    }
    expect(await getCamera(page)).toEqual(camBefore);
    const scroll = await page.evaluate(() => ({
      window: window.scrollY + window.scrollX,
      page: (document.scrollingElement?.scrollTop ?? 0) + (document.scrollingElement?.scrollLeft ?? 0),
      board: (document.querySelector('[data-testid="board-viewport"]') as HTMLElement).scrollTop,
    }));
    expect(scroll).toEqual({ window: 0, page: 0, board: 0 });

    await page.keyboard.press('Delete');
    await expect(noteLocator(page)).toHaveCount(SELECTION_RETRO_NOTES - six.length);
    const left = (await getNotes(page)).map((n) => n.id);
    for (const id of six) expect(left).not.toContain(id);
    expect(await selectionOf(page)).toEqual([]);
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('Ctrl/Cmd+A selects every note without selecting page text; Escape clears', async ({ page, baseURL }) => {
    await openSeededBoard(page, baseURL!);
    await page.getByTestId('board-viewport').click({ position: EMPTY_SPOT });
    await page.keyboard.press('ControlOrMeta+a');
    await expect(selectionBar(page)).toContainText(`${SELECTION_RETRO_NOTES} selected`);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await page.keyboard.press('Escape');
    expect(await selectionOf(page)).toEqual([]);
  });
});

test.describe('Workflow: colleague deletes while I select', () => {
  test('TC-35 Sam deletes one of Lee\'s 4 selected notes → Lee sees "3 selected", Delete removes exactly those 3', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const boardId = newBoardId();
    await seedBoard(baseURL!, boardId, selectionRetroBoard());
    const people = await openParticipants(browser, ['Lee', 'Sam'], boardId);
    const [lee, sam] = people.map((p) => p.page) as [Page, Page];
    try {
      for (const page of [lee, sam]) {
        await expect(noteLocator(page)).toHaveCount(SELECTION_RETRO_NOTES);
        await setCamera(page, CAMERA);
        await nextFrames(page);
      }
      const [row0] = await clusterIds(lee);
      const four = row0!.slice(0, 4);
      await marquee(
        lee,
        { x: slot(0, 0).x - MARGIN, y: slot(0, 0).y - MARGIN },
        { x: slot(0, 3).x + NOTE + MARGIN, y: slot(0, 3).y + NOTE + MARGIN },
      );
      expect(await selectionOf(lee)).toEqual([...four].sort());
      await expect(selectionBar(lee)).toContainText('4 selected');

      // Sam selects one of them (column 1) and presses Delete.
      const victim = four[1]!;
      const p = toScreen({ x: slot(0, 1).x + GRAB_OFFSET.x, y: slot(0, 1).y + GRAB_OFFSET.y });
      await sam.mouse.click(p.x, p.y);
      expect(await selectionOf(sam)).toEqual([victim]);
      await sam.keyboard.press('Delete');

      await expectWithin(() => lee.locator(`[data-id="${victim}"]`).count()).toBe(0);
      await expectWithin(async () => (await selectionBar(lee).textContent()) ?? '').toContain('3 selected');
      const remaining = four.filter((id) => id !== victim);
      expect(await selectionOf(lee)).toEqual([...remaining].sort());
      for (const id of remaining) await expect(noteLocator(lee, id)).toHaveAttribute('data-selected', 'true');

      await lee.keyboard.press('Delete');
      await expect(noteLocator(lee)).toHaveCount(SELECTION_RETRO_NOTES - four.length);
      const leftOnSam = async () => (await getNotes(sam)).map((n) => n.id).sort();
      const expected = (await getNotes(lee)).map((n) => n.id).sort();
      for (const id of four) expect(expected).not.toContain(id);
      await expectWithin(leftOnSam).toEqual(expected);
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('Workflow: full-capacity reorganisation', () => {
  test('TC-36 MAX_CONCURRENT_EDITORS people move different selections at once → identical final positions', async ({
    browser,
    browserName,
    baseURL,
  }) => {
    // Firefox delivers simultaneous mouse input to only some of several windows (background
    // windows drop or misroute it), so the concurrent drags themselves do not happen there.
    test.skip(browserName !== 'chromium', 'simultaneous multi-window mouse input is Chromium-only');
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const boardId = newBoardId();
    await seedBoard(baseURL!, boardId, selectionRetroBoard());
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
    const people = await openParticipants(browser, names, boardId);
    const pages = people.map((p) => p.page);
    try {
      for (const page of pages) {
        await expect(noteLocator(page)).toHaveCount(SELECTION_RETRO_NOTES);
        await setCamera(page, CAMERA);
        await nextFrames(page);
      }
      const grid = await clusterIds(pages[0]!);
      // Person i box-selects column i of cluster 1 (both rows): 2 notes each, all different.
      // Selecting is set-up, done one person at a time (Firefox drops modifier+mouse input to
      // background windows); the moves below are the simultaneous part.
      for (const [i, page] of pages.entries()) {
        await page.bringToFront();
        await marquee(
          page,
          { x: slot(0, i).x - MARGIN, y: slot(0, i).y - MARGIN },
          { x: slot(1, i).x + NOTE + MARGIN, y: slot(1, i).y + NOTE + MARGIN },
        );
      }
      for (const [i, page] of pages.entries()) {
        expect(await selectionOf(page)).toEqual([grid[0]![i]!, grid[1]![i]!].sort());
      }
      const before = await getNotes(pages[0]!);
      const offsets = pages.map((_, i) => ({ x: (i % HALF === 0 ? 1 : -1) * (BASE_DX + i * STEP_DX), y: BASE_DY + i * STEP_DY }));
      const grabs = pages.map((_, i) => toScreen({ x: slot(0, i).x + GRAB_OFFSET.x, y: slot(0, i).y + GRAB_OFFSET.y }));
      // Everyone presses first, then everyone drags at the same time, then everyone releases.
      await Promise.all(pages.map((page, i) => page.mouse.move(grabs[i]!.x, grabs[i]!.y).then(() => page.mouse.down())));
      await Promise.all(
        pages.map((page, i) =>
          page.mouse.move(grabs[i]!.x + offsets[i]!.x, grabs[i]!.y + offsets[i]!.y, { steps: DRAG_STEPS }),
        ),
      );
      await Promise.all(pages.map((page) => page.mouse.up()));

      const expected = before
        .map((n) => {
          const i = pages.findIndex((_, c) => grid[0]![c] === n.id || grid[1]![c] === n.id);
          const d = i < 0 ? { x: 0, y: 0 } : offsets[i]!;
          return { id: n.id, x: n.x + d.x, y: n.y + d.y };
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const positions = async (page: Page) =>
        (await getNotes(page)).map((n) => ({ id: n.id, x: n.x, y: n.y })).sort((a, b) => (a.id < b.id ? -1 : 1));
      for (const page of pages) await expectWithin(() => positions(page)).toEqual(expected);
      for (const page of pages) expect(await positions(page)).toEqual(expected);
    } finally {
      await closeParticipants(people);
    }
  });
});
