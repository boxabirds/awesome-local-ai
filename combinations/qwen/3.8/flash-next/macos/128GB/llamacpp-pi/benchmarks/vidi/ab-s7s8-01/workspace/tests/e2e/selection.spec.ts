// Story 7 — select, move, resize and delete several objects at once.
// Design tests TC-32 to TC-36: the marquee's containment rule, a cluster moved
// and resized as a group, the keyboard commands, a colleague deleting something
// I have selected, and a full-capacity reorganisation.
//
// Everything here goes through the shipped app: notes are seeded through the
// test-only window.__vidi6 hook (a --mode test build), interaction is real
// Playwright input, and positions are read back from the board model.

import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  mouseDrag,
  openBoard,
  seedSticky,
  snapshot,
  waitSticky,
  worldToScreen,
} from './helpers/board';
import {
  allSnaps,
  createRoom,
  errorCollector,
  openRoom,
  waitConverged,
} from './helpers/live';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/** A board-model row as the story 7 assertions need it. */
interface Row {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

function rows(page: Page): Promise<Row[]> {
  return page.evaluate(
    () => window.__vidi6!.snapshot() as unknown as Row[],
  );
}

/** Index rows by id (so the before/after comparisons read as maps). */
function byId(list: Row[]): Record<string, Row> {
  return Object.fromEntries(list.map((r) => [r.id, r] as const));
}

async function rowById(page: Page, id: string): Promise<Row> {
  const all = await rows(page);
  const row = all.find((r) => r.id === id);
  if (!row) throw new Error(`object ${id} is not on the board`);
  return row;
}

/** The whole (local) selection of this client. */
function selectionIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __vidi6: { selectedIds(): string[] } }).__vidi6.selectedIds(),
  );
}

async function expectSelection(page: Page, ids: string[]): Promise<void> {
  await expect
    .poll(() => selectionIds(page).then((s) => [...s].sort()), { timeout: 5_000 })
    .toEqual([...ids].sort());
}

/** The centre of a selection handle, in page pixels. */
async function handleCenter(page: Page, handle: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`[data-testid="resize-handle"][data-handle="${handle}"]`)
    .boundingBox();
  if (!box) throw new Error(`handle ${handle} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Shift+drag on the background between two WORLD points (the marquee). */
async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const a = await worldToScreen(page, from);
  const b = await worldToScreen(page, to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** The page-pixel centre of a seeded note (seedSticky centres on a world point). */
async function worldCenterOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const row = await rowById(page, id);
  return worldToScreen(page, { x: row.x + row.width / 2, y: row.y + row.height / 2 });
}

async function makeClients(browser: Browser, n: number, room: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    pages.push(await ctx.newPage());
  }
  await Promise.all(pages.map((p) => openRoom(p, room)));
  return pages;
}

async function closeClients(browser: Browser): Promise<void> {
  for (const c of browser.contexts()) await c.close();
}

test('TC-32 a marquee takes exactly the objects fully inside it', async ({ page }) => {
  await openBoard(page);
  // All coordinates below are WORLD points inside the visible region, so every
  // pointer event lands on screen (zoom is exactly 1, 1280x800 viewport).
  const a = await seedSticky(page, -250, -150); // rect x -350..-150
  const b = await seedSticky(page, 0, -150); // rect x -100..100
  const c = await seedSticky(page, 450, 250); // rect x 350..550, y 150..350
  await Promise.all([waitSticky(page, a), waitSticky(page, b), waitSticky(page, c)]);

  // 1) A is fully inside the box; B is cut by its right edge; C is far away.
  const start = await worldToScreen(page, { x: -420, y: -320 });
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const corner = await worldToScreen(page, { x: 0, y: 10 });
  await page.mouse.move(corner.x, corner.y, { steps: 8 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expectSelection(page, [a]);
  await expect(page.getByTestId('marquee')).toHaveCount(0);
  // One sticky note: the note toolbar covers it, so there is no selection bar —
  // but the selection is still announced.
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await expect(page.getByTestId('note-toolbar')).toHaveCount(1);
  await expect(page.getByTestId('selection-status')).toContainText('1 selected');

  // 2) The marquee is additive: a second box around B adds it and keeps A.
  await marquee(page, { x: -120, y: -320 }, { x: 150, y: 10 });
  await expectSelection(page, [a, b]);
  await expect(page.getByTestId('selection-bar')).toContainText('2 selected');

  // 3) A box around everything ends up with all three.
  await marquee(page, { x: -480, y: -350 }, { x: 600, y: 380 });
  await expectSelection(page, [a, b, c]);
  await expect(page.getByTestId('selection-bar')).toContainText('3 selected');

  // 4) Escape clears; a marquee over empty board selects nothing.
  await page.keyboard.press('Escape');
  await expectSelection(page, []);
  await marquee(page, { x: -500, y: 200 }, { x: -300, y: 380 });
  await expectSelection(page, []);
});

test('TC-32b a plain drag pans the board and selects nothing', async ({ page }) => {
  await openBoard(page);
  const a = await seedSticky(page, 0, 0);
  await waitSticky(page, a);
  const at = await worldCenterOf(page, a);
  await page.mouse.click(at.x, at.y);
  await expectSelection(page, [a]);

  const before = await page.evaluate(() => window.__vidi6!.getCamera());
  await mouseDrag(page, 900, 600, -120, -80);

  const after = await page.evaluate(() => window.__vidi6!.getCamera());
  expect(after).not.toEqual(before); // the board panned
  await expectSelection(page, [a]); // and the selection survived: a pan is not a click
  await expect(page.getByTestId('marquee')).toHaveCount(0);
});

test('TC-33 a cluster moves above the rest and resizes with its gaps', async ({ page }) => {
  await openBoard(page);
  // A tight 3x2 cluster around the world origin, plus a keeper note that starts
  // on top of it (created last) and must end up behind the moved cluster.
  const cluster: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -260 + (i % 3) * 260;
    const y = -160 + Math.floor(i / 3) * 260;
    cluster.push(await seedSticky(page, x, y));
  }
  const keeper = await seedSticky(page, 520, 300);
  await Promise.all([...cluster, keeper].map((id) => waitSticky(page, id)));
  const before = byId(await rows(page));
  expect(before[keeper]!.z).toBeGreaterThan(before[cluster[5]!]!.z);

  // Select the cluster: Ctrl/Cmd+A, then Shift-click the keeper back out.
  await page.keyboard.press('Control+a');
  await expect
    .poll(() => selectionIds(page).then((s) => s.length), { timeout: 5_000 })
    .toBe(7);
  const keeperAt = await worldCenterOf(page, keeper);
  await page.keyboard.down('Shift');
  await page.mouse.click(keeperAt.x, keeperAt.y);
  await page.keyboard.up('Shift');
  await expectSelection(page, cluster);
  await expect(page.getByTestId('selection-bar')).toContainText('6 selected');
  await expect(page.getByTestId('resize-handle')).toHaveCount(8);

  // --- move the whole cluster by 300 world units -----------------------------
  const first = await worldCenterOf(page, cluster[0]!);
  await mouseDrag(page, first.x, first.y, -300, 0);
  await expect
    .poll(() => rowById(page, cluster[0]!).then((r) => r.x), { timeout: 5_000 })
    .toBeCloseTo(before[cluster[0]!]!.x - 300, 1);
  for (const id of cluster) {
    const r = await rowById(page, id);
    expect(r.x, `note ${id} moved with the group`).toBeCloseTo(before[id]!.x - 300, 1);
    expect(r.y).toBeCloseTo(before[id]!.y, 1);
  }
  expect((await rowById(page, keeper)).x).toBe(before[keeper]!.x);
  // The moved cluster is now above the note that used to be on top.
  const movedZ = await Promise.all(cluster.map((id) => rowById(page, id).then((r) => r.z)));
  expect(Math.min(...movedZ)).toBeGreaterThan((await rowById(page, keeper)).z);

  // --- resize the whole cluster from a corner --------------------------------
  const selectedBefore = (await rows(page)).filter((r) => cluster.includes(r.id));
  const bboxWidth =
    Math.max(...selectedBefore.map((r) => r.x + r.width)) - Math.min(...selectedBefore.map((r) => r.x));
  const gapBefore = before[cluster[1]!]!.x - (before[cluster[0]!]!.x + before[cluster[0]!]!.width);

  const handle = await handleCenter(page, 'se');
  await mouseDrag(page, handle.x, handle.y, 150, 150);

  const after = byId(await rows(page));
  const grown = after[cluster[0]!]!.width;
  expect(grown).toBeGreaterThan(before[cluster[0]!]!.width);
  for (const id of cluster) {
    // Sticky notes stay SQUARE, and every note ends up the same size.
    expect(after[id]!.width, `note ${id} stayed square`).toBeCloseTo(after[id]!.height, 1);
    expect(after[id]!.width).toBeCloseTo(grown, 1);
  }
  // The gaps scaled with the cluster: the same relative layout, bigger.
  const gapAfter = after[cluster[1]!]!.x - (after[cluster[0]!]!.x + after[cluster[0]!]!.width);
  const bboxAfter =
    Math.max(...cluster.map((id) => after[id]!.x + after[id]!.width)) - Math.min(...cluster.map((id) => after[id]!.x));
  expect(gapAfter / gapBefore).toBeCloseTo(bboxAfter / bboxWidth, 1);
  // The keeper kept its own size.
  expect((await rowById(page, keeper)).width).toBeCloseTo(before[keeper]!.width, 1);

  // Shrinking past the type's minimum stops there: every note ends at exactly
  // STICKY_MIN_SIZE_WORLD, square, never inverted and never smaller.
  const inward = await handleCenter(page, 'se');
  await mouseDrag(page, inward.x, inward.y, -800, -600);
  const shrunk = byId(await rows(page));
  for (const id of cluster) {
    expect(shrunk[id]!.width, `note ${id} stopped at the minimum`).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
    expect(shrunk[id]!.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 1);
  }
  expect((await rowById(page, keeper)).width).toBeCloseTo(before[keeper]!.width, 1);
});

test('TC-34 arrows nudge the selection without scrolling or panning; Delete removes it', async ({ page }) => {
  await openBoard(page);
  const cluster: string[] = [];
  for (let i = 0; i < 6; i++) {
    cluster.push(await seedSticky(page, -260 + (i % 3) * 260, -160 + Math.floor(i / 3) * 260));
  }
  const keeper = await seedSticky(page, 520, 300);
  await Promise.all([...cluster, keeper].map((id) => waitSticky(page, id)));
  const before = byId(await rows(page));
  const camera0 = await page.evaluate(() => window.__vidi6!.getCamera());

  await page.keyboard.press('Control+a');
  await expect
    .poll(() => selectionIds(page).then((s) => s.length), { timeout: 5_000 })
    .toBe(7);
  const keeperAt = await worldCenterOf(page, keeper);
  await page.keyboard.down('Shift');
  await page.mouse.click(keeperAt.x, keeperAt.y);
  await page.keyboard.up('Shift');
  await expectSelection(page, cluster);

  // Three small steps and one large step: exactly 3 + 10 world units right.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  const nudged = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
  await expect
    .poll(() => rowById(page, cluster[5]!).then((r) => r.x), { timeout: 5_000 })
    .toBeCloseTo(before[cluster[5]!]!.x + nudged, 3);
  for (const id of cluster) {
    const r = await rowById(page, id);
    expect(r.x, `note ${id} nudged with the group`).toBeCloseTo(before[id]!.x + nudged, 3);
    expect(r.y).toBeCloseTo(before[id]!.y, 3);
  }

  // Nothing scrolled, nothing panned, the unselected note stayed put, the
  // selection survived the keys.
  expect((await rowById(page, keeper)).x).toBe(before[keeper]!.x);
  expect(await page.evaluate(() => window.__vidi6!.getCamera())).toEqual(camera0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expectSelection(page, cluster);

  // Delete removes the whole selection at once.
  await page.keyboard.press('Delete');
  await expect
    .poll(() => snapshot(page).then((s) => s.length), { timeout: 5_000 })
    .toBe(1);
  await expectSelection(page, []);
  expect((await rowById(page, keeper)).x).toBe(before[keeper]!.x);
  expect(await page.getByTestId('selection-bar').count()).toBe(0);
});

test('TC-34b the board consumes the arrow key, so the page cannot scroll', async ({ page }) => {
  await openBoard(page);
  const a = await seedSticky(page, 0, 0);
  await waitSticky(page, a);
  const at = await worldCenterOf(page, a);
  await page.mouse.click(at.x, at.y);
  await expectSelection(page, [a]);

  // The key reaches the board's window listener and is preventDefault-ed (a page
  // scroll or a browser shortcut would take it otherwise).
  const prevented = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
  // And it was the board that acted: the selected note moved by one world unit.
  expect((await rowById(page, a)).x).toBeCloseTo(-100 + NUDGE_STEP_WORLD, 3);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('TC-35 a colleague deleting a selected note drops it from my selection', async ({ browser, request }) => {
  const room = await createRoom(request);
  const [lee, sam] = await makeClients(browser, 2, room);
  const errors = errorCollector(lee);

  // A 20-note board; the top row is the one Lee marquee-selects.
  const grid: string[] = [];
  for (let i = 0; i < 20; i++) {
    grid.push(await seedSticky(lee!, -400 + (i % 5) * 230, -260 + Math.floor(i / 5) * 230));
  }
  await waitConverged([lee!, sam!]);
  const row = grid.slice(0, 4); // the four leftmost notes of the top row
  const doomed = row[2]!;

  // Lee Shift+drags a marquee around exactly those four.
  await marquee(lee!, { x: -505, y: -365 }, { x: 395, y: -155 });
  await expectSelection(lee!, row);
  await expect(lee!.getByTestId('selection-bar')).toContainText('4 selected');
  await expect(lee!.locator('[data-selected="true"]')).toHaveCount(4);

  // Sam selects one of the selected notes and deletes it.
  const at = await worldCenterOf(sam!, doomed);
  await sam!.mouse.click(at.x, at.y);
  await expect
    .poll(
      () => sam!.evaluate(() => (window as unknown as { __vidi6: { selectedIds(): string[] } }).__vidi6.selectedIds()),
      { timeout: 5_000 },
    )
    .toEqual([doomed]);
  await sam!.keyboard.press('Delete');

  // Lee sees it inside the live-update budget: the note is gone, the bar reads
  // "3 selected", the survivors are still outlined.
  await expectSelection(lee!, row.filter((id) => id !== doomed));
  await expect(lee!.getByTestId('selection-bar')).toContainText('3 selected');
  await expect(lee!.locator(`[data-note-id="${doomed}"]`)).toHaveCount(0);
  await expect(lee!.locator('[data-selected="true"]')).toHaveCount(3);

  // And Lee's Delete now removes exactly the three survivors.
  await lee!.keyboard.press('Delete');
  await expect
    .poll(() => snapshot(lee!).then((s) => s.length), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toBe(20 - 4);
  await expectSelection(lee!, []);
  await expect
    .poll(() => snapshot(sam!).then((s) => s.length), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toBe(20 - 4);
  expect(errors).toEqual([]);
  await closeClients(browser);
});

test('TC-36 full capacity: five clients move different selections at once', async ({ browser, request }) => {
  const room = await createRoom(request);
  const pages = await makeClients(browser, MAX_CONCURRENT_EDITORS, room);
  const errors = pages.map((p) => errorCollector(p));

  // One note per client, laid out where every client can reach it.
  const ids: string[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    ids.push(await seedSticky(pages[0]!, -450 + i * 220, -100 + (i % 2) * 220));
  }
  await waitConverged(pages);
  const before = byId(await rows(pages[0]!));

  // Every client selects ITS note and drags it by 60 pixels (zoom is exactly 1,
  // so 60 world units) — all at the same time.
  await Promise.all(
    pages.map(async (page, i) => {
      const at = await worldCenterOf(page, ids[i]!);
      await mouseDrag(page, at.x, at.y, 60, 0);
    }),
  );

  // All clients converge on the same document…
  await waitConverged(pages);
  // …and every note ended exactly where its owner dragged it.
  const final = byId(await rows(pages[0]!));
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    const id = ids[i]!;
    expect(final[id]!.x, `note ${i} moved with its own drag`).toBeCloseTo(before[id]!.x + 60, 1);
    expect(final[id]!.y).toBeCloseTo(before[id]!.y, 1);
  }
  // Every client reports the identical state for every note.
  for (const page of pages) {
    const onThisPage = byId(await rows(page));
    for (const id of ids) {
      expect(onThisPage[id]!.x).toBeCloseTo(final[id]!.x, 3);
      expect(onThisPage[id]!.y).toBeCloseTo(final[id]!.y, 3);
    }
  }
  expect(await allSnaps(pages)).toBeTruthy();
  for (const collected of errors) expect(collected).toEqual([]);
  // The notes are square (resizing is offered for them, moving never distorts).
  expect(final[ids[0]!]!.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
  await closeClients(browser);
});
