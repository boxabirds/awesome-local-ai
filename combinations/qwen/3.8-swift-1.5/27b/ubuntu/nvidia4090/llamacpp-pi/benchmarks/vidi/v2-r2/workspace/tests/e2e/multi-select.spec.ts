import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { apiCreateBoard, E2E_BASE_URL, setCamera } from './helpers/board';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

const noteSelector = '[data-note-id]';

interface ObjSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

async function getObjects(page: Page): Promise<ObjSnap[]> {
  return page.evaluate(() => (window as any).__vidi6?.objects?.() ?? []);
}

async function waitForConnected(page: Page) {
  await page.waitForFunction(
    () => (window as any).__vidi6?.connectionState === 'connected',
    { timeout: E2E_EVENTUAL_TIMEOUT_MS }
  );
}

/** Seed stickies (world coords, centred) through the test hook. Returns the ids. */
async function seedNotes(page: Page, centres: ReadonlyArray<{ x: number; y: number }>): Promise<string[]> {
  return page.evaluate(async (pts) => {
    const out: string[] = [];
    for (const p of pts) out.push((window as any).__vidi6.createSticky(p.x, p.y));
    return out;
  }, centres);
}

/** Shift+drag a marquee from screen (x1,y1) to (x2,y2). */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Plain drag from screen (x1,y1) to (x2,y2). */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}

async function selectedIds(page: Page): Promise<string[]> {
  const els = page.locator(`${noteSelector}[data-selected="true"]`);
  const n = await els.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await els.nth(i).getAttribute('data-note-id') ?? '');
  return ids.sort();
}

function key(n: ObjSnap) {
  return `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}`;
}

function snapsEqual(a: ObjSnap[], b: ObjSnap[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
}

test.describe('Story 7: multi-select e2e (TC-32 to TC-36)', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(60_000);

  test('TC-32: marquee selects fully-inside notes only (A in, B half in, C out)', async ({ page }) => {
    const boardId = await apiCreateBoard();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForConnected(page);
    await setCamera(page, -640, -400, 1);

    // A centred (0,0) → screen 540-740 × 300-500 (fully inside the marquee)
    // B centred (350,0) → screen 890-1090 (half inside)
    // C centred (800,0) → screen 1340-1540 (outside)
    const [aId, bId, cId] = await seedNotes(page, [
      { x: 0, y: 0 },
      { x: 350, y: 0 },
      { x: 800, y: 0 },
    ]);

    // Marquee screen (500,260)-(1000,540) = world (-140,-140)-(360,140):
    // A (-100..100)² fully inside; B (250..450) not; C (600..800) not.
    await marquee(page, 500, 260, 1000, 540);

    const sel = await selectedIds(page);
    expect(sel).toEqual([aId]);
    expect(sel).not.toContain(bId);
    expect(sel).not.toContain(cId);
  });

  test('TC-33: group move 300 world units (z above the 4th note), se-handle resize keeps squares, shrink clamps at min', async ({ page }) => {
    const boardId = await apiCreateBoard();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForConnected(page);
    await setCamera(page, -640, -400, 0.5);

    // 6-note 3×2 grid (centres) + a 4th note D the moved cluster must overlap.
    const grid = [
      { x: 0, y: 0 }, { x: 250, y: 0 }, { x: 500, y: 0 },
      { x: 0, y: 250 }, { x: 250, y: 250 }, { x: 500, y: 250 },
    ];
    const [g0, g1, g2, g3, g4, g5, dId] = await seedNotes(page, [...grid, { x: 700, y: 125 }]);
    const groupIds = [g0, g1, g2, g3, g4, g5];

    // Marquee over the grid: screen (260,140)-(630,385) = world (-120,-120)-(620,370).
    // Grid world (-100..600, -100..350) fully inside; D (600..800, 25..225) not.
    await marquee(page, 260, 140, 630, 385);
    expect(await selectedIds(page)).toEqual([...groupIds].sort());

    const before = await getObjects(page);
    const dBefore = before.find((n) => n.id === dId)!;

    // Drag one selected note +150 screen px = +300 world units (zoom 0.5).
    // Note g4 centred (250,250) → screen ((250+640)*0.5, (250+400)*0.5) = (445, 325).
    await drag(page, 445, 325, 595, 325);

    const after = await getObjects(page);
    for (const id of groupIds) {
      const b = before.find((n) => n.id === id)!;
      const a = after.find((n) => n.id === id)!;
      expect(a.x - b.x).toBeCloseTo(300, 5);
      expect(a.y - b.y).toBeCloseTo(0, 5);
      // Brought to front: every moved note now renders above D.
      expect(a.z).toBeGreaterThan(dBefore.z);
    }

    // se handle at the cluster's new bounds (200,-100)-(900,350) → screen (770, 375).
    // Drag +100,+100 screen px = +200,+200 world. Aspect-locked:
    // scale = max(900/700, 650/450) = 650/450 ≈ 1.4444 → stickies ≈ 288.9².
    const se = page.getByLabel('Resize bottom-right');
    await se.hover();
    await drag(page, 770, 375, 870, 475);

    const resized = await getObjects(page);
    const expected = STICKY_SIZE_WORLD * (650 / 450);
    for (const id of groupIds) {
      const n = resized.find((o) => o.id === id)!;
      expect(n.width).toBeCloseTo(expected, 0);
      expect(n.height).toBeCloseTo(expected, 0);
    }
    // Gaps scale with the same factor: g0→g1 centre distance 250 → 250*(650/450).
    const r0 = resized.find((o) => o.id === g0)!;
    const r1 = resized.find((o) => o.id === g1)!;
    expect(r1.x - r0.x).toBeCloseTo(250 * (650 / 450), 0);

    // Shrink far past the minimum → clamps at STICKY_MIN_SIZE_WORLD.
    // Bounds after resize: 1011.1×650; stickies 288.9². The min scale is
    // 50/288.9 ≈ 0.1731. Dragging se by (-850,-550) world gives
    // scale = max(0.1593, 0.1538) < 0.1731 → clamped to the minimum.
    // (-850,-550) world = (-425,-275) screen at zoom 0.5.
    const seBox = await se.boundingBox();
    expect(seBox).not.toBeNull();
    const seCx = seBox!.x + seBox!.width / 2;
    const seCy = seBox!.y + seBox!.height / 2;
    await drag(page, seCx, seCy, seCx - 425, seCy - 275);

    const clamped = await getObjects(page);
    for (const id of groupIds) {
      const n = clamped.find((o) => o.id === id)!;
      expect(n.width).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
      expect(n.height).toBeCloseTo(STICKY_MIN_SIZE_WORLD, 0);
    }
  });

  test('TC-34: arrow nudge (+3 small, +1 large), no scroll/pan, Delete removes all 6', async ({ page }) => {
    const boardId = await apiCreateBoard();
    await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForConnected(page);
    await setCamera(page, -640, -400, 0.75);

    const grid = [
      { x: 0, y: 0 }, { x: 250, y: 0 }, { x: 500, y: 0 },
      { x: 0, y: 250 }, { x: 250, y: 250 }, { x: 500, y: 250 },
    ];
    const ids = await seedNotes(page, grid);

    // Marquee screen (390,210)-(945,578) = world (-120,-120)-(620,~371) covers the grid.
    await marquee(page, 390, 210, 945, 578);
    expect(await selectedIds(page)).toEqual([...ids].sort());

    const before = await getObjects(page);
    const transformBefore = await page.locator('[data-testid="world-layer"]').evaluate((el) => (el as HTMLElement).style.transform);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const nudged = await getObjects(page);
    for (const id of ids) {
      const b = before.find((n) => n.id === id)!;
      const a = nudged.find((n) => n.id === id)!;
      expect(a.x - b.x).toBeCloseTo(NUDGE_STEP_WORLD * 3, 5);
      expect(a.y - b.y).toBeCloseTo(0, 5);
    }

    await page.keyboard.press('Shift+ArrowRight');
    const large = await getObjects(page);
    for (const id of ids) {
      const b = before.find((n) => n.id === id)!;
      const a = large.find((n) => n.id === id)!;
      expect(a.x - b.x).toBeCloseTo(NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD, 5);
    }

    // No page scroll, no camera change.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const transformAfter = await page.locator('[data-testid="world-layer"]').evaluate((el) => (el as HTMLElement).style.transform);
    expect(transformAfter).toBe(transformBefore);

    // Delete removes all 6.
    await page.keyboard.press('Delete');
    await expect(page.locator(noteSelector)).toHaveCount(0);
  });

  test('TC-35: colleague deletes one of my selected notes → bar prunes to 3, Delete removes exactly those 3', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const ctxLee = await browser.newContext();
    const ctxSam = await browser.newContext();
    const lee = await ctxLee.newPage();
    const sam = await ctxSam.newPage();
    await lee.setViewportSize({ width: 1280, height: 800 });
    await sam.setViewportSize({ width: 1280, height: 800 });
    await lee.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await sam.goto(`${E2E_BASE_URL}/b/${boardId}`);
    await waitForConnected(lee);
    await waitForConnected(sam);
    await setCamera(lee, 660, -100, 1);
    await setCamera(sam, 660, -100, 1);

    // 20 notes: 5 rows of 4 (group g: centres x 1000g+200+100k, y 300).
    const centres: { x: number; y: number }[] = [];
    for (let g = 0; g < 5; g++) {
      for (let k = 0; k < 4; k++) centres.push({ x: 1000 * g + 200 + 100 * k, y: 300 });
    }
    const ids = await seedNotes(lee, centres);
    // All contexts see all 20.
    await expect.poll(async () => (await getObjects(sam)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(20);

    // Group 1 (world x 1100..1600, y 200..400) renders at screen (440..960, 300..500).
    // Lee marquee-selects exactly those 4.
    const group1 = ids.slice(4, 8);
    await marquee(lee, 420, 280, 980, 520);
    expect(await selectedIds(lee)).toEqual([...group1].sort());
    await expect(lee.getByText('4 selected')).toBeVisible();

    // Sam selects one of Lee's selected notes and deletes it.
    // Note centred world (1200,300) → screen ((1200-660), (300+100)) = (540, 400).
    const victim = ids[5];
    await sam.mouse.click(540, 400);
    await expect.poll(async () => (await selectedIds(sam)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await sam.keyboard.press('Delete');

    // Lee: within the live latency budget the note vanishes and the bar prunes.
    const t0 = Date.now();
    await expect.poll(async () => {
      const objs = await getObjects(lee);
      const sel = await selectedIds(lee);
      return !objs.some((o) => o.id === victim) && sel.length === 3;
    }, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 }).toBeTruthy();
    console.log(`  [latency] TC-35 prune: ${Date.now() - t0}ms`);

    await expect(lee.getByText('3 selected')).toBeVisible();
    const remaining = await selectedIds(lee);
    expect(remaining).toEqual([...group1].filter((id) => id !== victim).sort());

    // Lee deletes the remaining 3 → exactly 16 notes left (20 − 4 from group 1).
    await lee.keyboard.press('Delete');
    await expect.poll(async () => (await getObjects(lee)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(16);
    await expect.poll(async () => (await getObjects(sam)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(16);

    await ctxLee.close();
    await ctxSam.close();
  });

  test('TC-36: MAX_CONCURRENT_EDITORS contexts each move a different selection → identical final positions', async ({ browser }) => {
    const boardId = await apiCreateBoard();
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${E2E_BASE_URL}/b/${boardId}`);
      await waitForConnected(page);
      await setCamera(page, -600, -625, 0.4);
      contexts.push(ctx);
      pages.push(page);
    }

    // 20 notes: 5 columns × 4 rows. Column c centres x = 200+400c, rows y = 0,250,500,750.
    const centres: { x: number; y: number }[] = [];
    for (let c = 0; c < 5; c++) {
      for (const y of [0, 250, 500, 750]) centres.push({ x: 200 + 400 * c, y });
    }
    await seedNotes(pages[0], centres);
    await expect.poll(async () => (await getObjects(pages[4])).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(20);

    // Each context marquee-selects its own column and drags it by a distinct offset.
    // Column c renders at screen x (160c+280)..(160c+360), y 210..590.
    const t0 = Date.now();
    await Promise.all(pages.map(async (page, i) => {
      await marquee(page, 160 * i + 270, 200, 160 * i + 370, 600);
      const sel = await selectedIds(page);
      expect(sel).toHaveLength(4);
      // Drag the column +50*(i+1) world units (20*(i+1) screen px at zoom 0.4),
      // starting on the top-row note (screen y 250).
      await drag(page, 160 * i + 320, 250, 160 * i + 320 + 20 * (i + 1), 250);
    }));

    // All contexts converge on identical final positions.
    await expect.poll(async () => {
      const snaps = await Promise.all(pages.map((p) => getObjects(p)));
      if (snaps.some((s) => s.length !== 20)) return false;
      return snaps.every((s) => snapsEqual(s, snaps[0]));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBeTruthy();
    console.log(`  [latency] TC-36 convergence: ${Date.now() - t0}ms`);

    // The per-column offsets are all present in the converged state:
    // column c's notes end at top-left x = 200+400c-100+50*(c+1).
    const final = await getObjects(pages[0]);
    for (let c = 0; c < 5; c++) {
      const expectedX = 200 + 400 * c - 100 + 50 * (c + 1);
      const col = final.filter((n) => Math.abs(n.x - expectedX) < 0.5);
      expect(col.length).toBe(4);
    }

    for (const ctx of contexts) await ctx.close();
  });
});
