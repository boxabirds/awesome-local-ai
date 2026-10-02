import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  clickBringToFront,
  clickDeleteNote,
  clickDeleteSelection,
  closeEditor,
  createNoteAt,
  createNoteClosed,
  dragResizeHandle,
  dragSelectedBy,
  getBoard,
  getNote,
  getSelectedIds,
  marqueeSelect,
  noteBox,
  noteIdAtPoint,
  selectAll,
  selectNote,
  shiftClickNote,
} from './helpers/board';
import { objectBounds } from '../../src/shared/board-model';

const gap = (left: { x: number; width?: number }, right: { x: number }) =>
  right.x - (left.x + (left.width ?? 200));

async function createBoardId(page: Page): Promise<string> {
  const res = await page.request.post('/api/boards');
  const { id } = await res.json();
  return id;
}

async function openOn(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${id}`);
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 10000 },
  );
  return page;
}

test.describe('Story 7: multi-select, move, resize, delete', () => {
  test.beforeEach(async ({ page }) => {
    const id = await createBoardId(page);
    await page.goto(`/b/${id}`);
    await page.waitForSelector('[data-testid="board-viewport"]');
  });

  test('TC-32: marquee-select a cluster and drag it to rearrange', async ({ page }) => {
    const n1 = await createNoteClosed(page, 250, 250);
    const n2 = await createNoteClosed(page, 250, 450);
    const n3 = await createNoteClosed(page, 250, 650);
    await page.mouse.click(950, 150); // empty: clear selection

    await marqueeSelect(page, 120, 120, 380, 780);
    expect((await getSelectedIds(page)).sort()).toEqual([n1.id, n2.id, n3.id].sort());

    const before = Object.fromEntries(
      (await getBoard(page)).map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    await dragSelectedBy(page, n1.id, 120, 80);

    const after = await getBoard(page);
    for (const n of after) {
      expect(n.x).toBeCloseTo(before[n.id].x + 120, 0);
      expect(n.y).toBeCloseTo(before[n.id].y + 80, 0);
    }
    expect((await getSelectedIds(page)).sort()).toEqual([n1.id, n2.id, n3.id].sort());
  });

  test('TC-33: bring-to-front raises the whole selection above another note', async ({ page }) => {
    const s1 = await createNoteClosed(page, 300, 300);
    const s2 = await createNoteClosed(page, 700, 300);
    // Created last so it overlaps and sits on top of s1 near (385, 385).
    const top = await createNoteClosed(page, 470, 470);
    await page.mouse.click(950, 650); // empty: clear selection

    const overlap = { x: 385, y: 385 };
    expect(await noteIdAtPoint(page, overlap.x, overlap.y)).toBe(top.id);

    // Select s1 (via a corner not covered by top) and s2.
    await page.mouse.click(250, 250);
    await shiftClickNote(page, s2.id);
    expect((await getSelectedIds(page)).sort()).toEqual([s1.id, s2.id].sort());

    await clickBringToFront(page);
    await expect
      .poll(() => noteIdAtPoint(page, overlap.x, overlap.y))
      .toBe(s1.id);
  });

  test('TC-34: delete removes the entire selection', async ({ page }) => {
    await createNoteClosed(page, 300, 300);
    await createNoteClosed(page, 600, 300);
    await createNoteClosed(page, 900, 300);
    await page.mouse.click(950, 650);

    await selectAll(page);
    expect(await getSelectedIds(page)).toHaveLength(3);
    await clickDeleteSelection(page);
    await expect.poll(() => getBoard(page)).toHaveLength(0);
    expect(await getSelectedIds(page)).toHaveLength(0);
  });

  test('TC-36: resizing a group scales each note and the gap between them', async ({ page }) => {
    const a = await createNoteClosed(page, 300, 300); // world box [200,400]
    const b = await createNoteClosed(page, 600, 300); // world box [500,700] → gap 100
    await page.mouse.click(950, 650);

    await selectAll(page);
    expect(await getSelectedIds(page)).toHaveLength(2);

    await dragResizeHandle(page, 'se', 500, 0); // ×2 off the width

    const [na, nb] = await getBoard(page);
    const [wa, wb] = [objectBounds(na).width, objectBounds(nb).width];
    expect(wa).toBeCloseTo(400, 0);
    expect(wb).toBeCloseTo(400, 0);
    const left = na.x < nb.x ? na : nb;
    const right = na.x < nb.x ? nb : na;
    expect(gap(objectBounds(left) as never, right)).toBeCloseTo(200, 0);
    // Heights are unchanged for a horizontal-only scale.
    expect(objectBounds(na).height).toBeCloseTo(200, 0);
    void a;
    void b;
  });

  test('TC-32: keyboard delete after select-all removes everything and clears selection', async ({
    page,
  }) => {
    await createNoteClosed(page, 300, 300);
    await createNoteClosed(page, 600, 500);
    await page.mouse.click(950, 650);
    await selectAll(page);
    await page.keyboard.press('Delete');
    await expect.poll(() => getBoard(page)).toHaveLength(0);
    expect(await getSelectedIds(page)).toHaveLength(0);
  });
});

test.describe('Story 7: remote delete prunes a live selection (TC-35)', () => {
  test('a note deleted by a colleague drops out of my selection', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const first = await ctxA.newPage();
    const boardId = await createBoardId(first);
    const alex = await openOn(ctxA, boardId);
    const sam = await openOn(ctxB, boardId);

    const n1 = await createNoteAt(alex, 300, 300);
    await closeEditor(alex);
    const n2 = await createNoteAt(alex, 650, 300);
    await closeEditor(alex);

    await expect.poll(() => getBoard(sam), { timeout: 10000, intervals: [200] }).toHaveLength(2);

    // Alex selects both notes.
    await selectNote(alex, n1.id);
    await shiftClickNote(alex, n2.id);
    expect((await getSelectedIds(alex)).sort()).toEqual([n1.id, n2.id].sort());

    // Sam deletes one of them.
    await selectNote(sam, n1.id);
    await clickDeleteNote(sam);

    // Alex sees the note disappear and its id pruned from the selection.
    await expect.poll(() => getBoard(alex), { timeout: 10000, intervals: [200] }).toHaveLength(1);
    await expect
      .poll(() => getSelectedIds(alex), { timeout: 5000, intervals: [200] })
      .toEqual([n2.id]);
    expect(await getNote(alex, n1.id)).toBeUndefined();

    await ctxA.close();
    await ctxB.close();
  });
});
