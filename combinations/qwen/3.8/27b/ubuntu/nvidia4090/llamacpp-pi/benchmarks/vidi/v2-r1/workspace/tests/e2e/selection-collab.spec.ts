// Story 7 e2e (wrangler config, chromium): multi-context collaboration.
//
// TC-35 proves sel.interaction's prune behaviour through the real sync path:
// a colleague deletes one of my selected notes and my selection bar updates
// within LIVE_UPDATE_LATENCY_BUDGET_MS. TC-36 is the full-capacity
// reorganisation: MAX_CONCURRENT_EDITORS contexts move different selections
// at the same time and converge on identical final positions (absolute
// writes, key decision 1).

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { selectionBoardFixture } from '../../tests/fixtures/boards';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';

/** Default e2e camera: screen = world + (640, 400). */
const SX = 640;
const SY = 400;

interface ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

async function getObjects(page: Page): Promise<Map<string, ObjectInfo>> {
  const list = await page.evaluate(() =>
    (window as unknown as { __vidi6: { getObjects(): ObjectInfo[] } }).__vidi6.getObjects(),
  );
  return new Map(list.map((o) => [o.id, o]));
}

async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-root"]', { timeout: 20000 });
}

/** Create a board through the story 5 API and return its id. */
async function createBoard(base: string): Promise<string> {
  const res = await fetch(`${base}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`board creation failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Seeds the 20-note fixture; returns the ids in fixture order. */
async function seedSelectionBoard(page: Page): Promise<{ a: string[]; b: string[] }> {
  const fixture = selectionBoardFixture();
  const all = [...fixture.a, ...fixture.b];
  return page.evaluate((seeds) => {
    const h = (window as unknown as {
      __vidi6: { createNoteAt(x: number, y: number, color: string, text: string): string };
    }).__vidi6;
    const ids = seeds.map((s) => h.createNoteAt(s.x, s.y, 'yellow', s.text));
    return { a: ids.slice(0, 10), b: ids.slice(10, 20) };
  }, all.map((s) => ({ x: s.center.x, y: s.center.y, text: s.text })));
}

/** Wait until every context sees all `total` notes (initial sync). */
async function waitAllSynced(pages: Page[], total: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const sizes = await Promise.all(pages.map(async (p) => (await getObjects(p)).size));
        return sizes.every((n) => n === total);
      },
      { timeout: 20000 },
    )
    .toBe(true);
}

/** Shift + click at (x, y) — the mouse API has no modifier options. */
async function shiftClick(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  await page.keyboard.up('Shift');
}

/** Shift + drag from (x1,y1) to (x2,y2) (the marquee). */
async function shiftDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

async function barCount(page: Page): Promise<string | null> {
  return page.locator('[data-testid="selection-count"]').textContent();
}

/** The ids of the notes currently outlined (selected) on the page. */
async function pageSelectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-selected="true"]')).map((el) =>
      el.getAttribute('data-id') as string,
    ),
  );
}

function centerOf(idx: number): { x: number; y: number } {
  return selectionBoardFixture().a[idx].center;
}

test.describe('story 7: selection collaboration (wrangler)', () => {
  test('TC-35: a colleague deletes one of my selected notes; my bar prunes within the latency budget', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const leeContext = await browser.newContext();
      const lee = await leeContext.newPage();
      await openBoard(lee, boardId);
      const { a } = await seedSelectionBoard(lee);

      const samContext = await browser.newContext();
      const sam = await samContext.newPage();
      await openBoard(sam, boardId);
      await waitAllSynced([lee, sam], 20);

      // Lee shift+drags a marquee that fully contains exactly the four
      // leftmost top-row notes a[0..3] (world (−630,−170) → (360,50) =
      // screen (10,230) → (1000,450)).
      await shiftDrag(lee, 10, 230, 1000, 450);
      await expect.poll(async () => barCount(lee), { timeout: 5000 }).toBe('4 selected');
      expect(new Set(await pageSelectedIds(lee))).toEqual(new Set(a.slice(0, 4)));

      // Sam selects a[2] (centre (0,−60) → screen (640,340)) and deletes it.
      const c2 = centerOf(2);
      await sam.mouse.click(c2.x + SX, c2.y + SY);
      await sam.keyboard.press('Delete');

      // Lee's screen must prune the id within the latency budget: the note
      // disappears, the bar reads "3 selected" and the other three keep
      // their outlines (the bar count derives from the pruned selection, so
      // once it reads 3 the pruning has happened).
      await expect.poll(async () => barCount(lee), {
        timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
      }).toBe('3 selected');
      expect((await getObjects(lee)).has(a[2])).toBe(false);
      expect((await pageSelectedIds(lee)).sort()).toEqual([a[0], a[1], a[3]].sort());

      // Lee presses Delete: exactly the remaining three are removed
      // (20 − 1 − 3 = 16 left).
      await lee.keyboard.press('Delete');
      await expect.poll(async () => (await getObjects(lee)).size, { timeout: 5000 }).toBe(16);
      const remaining = await getObjects(lee);
      expect(remaining.has(a[0])).toBe(false);
      expect(remaining.has(a[1])).toBe(false);
      expect(remaining.has(a[3])).toBe(false);
      expect(remaining.has(a[4])).toBe(true); // never selected

      await leeContext.close();
      await samContext.close();
    } finally {
      await wrangler.dispose();
    }
  });

  test('TC-36: five contexts move different selections at once and converge on identical positions', async ({ browser }) => {
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        contexts.push(ctx);
        pages.push(page);
        await openBoard(page, boardId);
      }
      // Seed from the first context; wait until every context sees the board.
      const { a } = await seedSelectionBoard(pages[0]);
      await waitAllSynced(pages, 20);

      // Context i selects the pair (a[2i], a[2i+1]) — together, all of
      // cluster A, each note in exactly one context's selection.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const c1 = centerOf(2 * i);
        const c2 = centerOf(2 * i + 1);
        await pages[i].mouse.click(c1.x + SX, c1.y + SY);
        await shiftClick(pages[i], c2.x + SX, c2.y + SY);
      }

      // Interleave the drags so the gestures overlap in time: everyone
      // presses, then everyone moves +300 world units right, then everyone
      // releases.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const c = centerOf(2 * i);
        await pages[i].mouse.move(c.x + SX, c.y + SY);
        await pages[i].mouse.down();
      }
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const c = centerOf(2 * i);
        await pages[i].mouse.move(c.x + SX + 300, c.y + SY, { steps: 4 });
      }
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        await pages[i].mouse.up();
      }

      // Wait until every context has the converged positions (absolute
      // writes converge regardless of the interleaving). The hooks report
      // top-left corners, so compare centres (x + width / 2).
      await expect
        .poll(async () =>
          Promise.all(
            pages.map(async (p) => {
              const objects = await getObjects(p);
              return a.every((id, j) => {
                const o = objects.get(id)!;
                const cx = o.x + o.width / 2;
                return Math.abs(cx - (centerOf(j).x + 300)) < 0.5;
              });
            }),
          ),
          { timeout: 15000 },
        )
        .toEqual(Array(MAX_CONCURRENT_EDITORS).fill(true));

      // Every context ends with the identical absolute positions.
      for (let ctxIdx = 0; ctxIdx < MAX_CONCURRENT_EDITORS; ctxIdx += 1) {
        const objects = await getObjects(pages[ctxIdx]);
        for (let j = 0; j < 10; j += 1) {
          const o = objects.get(a[j])!;
          expect(o.x + o.width / 2, `context ${ctxIdx}: note ${j} converged`).toBeCloseTo(
            centerOf(j).x + 300,
            3,
          );
          expect(o.y + o.height / 2, `context ${ctxIdx}: note ${j} unchanged in y`).toBeCloseTo(
            centerOf(j).y,
            3,
          );
        }
      }

      for (const ctx of contexts) await ctx.close();
    } finally {
      await wrangler.dispose();
    }
  });
});
