// Story 9 e2e (text config, chromium + firefox for TC-26): free text
// anywhere on the board. Real browsers, real fonts, real wrangler sync server.
//
// Covers the Text tool (text.tool_ui) and text objects (text.object):
//   TC-26  long annotation wraps to a 600-wide box with several lines
//   TC-27  dragging the right handle narrows (fixed width), rewraps, no v-handles
//   TC-28  golden path: XL heading, move, delete, Ctrl+Z restores
//   TC-29  two contexts type into one text concurrently -> converges, all chars
//   TC-30  MAX_CONCURRENT_EDITORS contexts each add a heading -> all on all screens
//   TC-31  abandoned text (T, click, Escape, no typing) leaves nothing selectable
//
// TC-26 also runs in firefox (wrapping differences within ±2 world units);
// the rest are chromium-only.

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';
import { makeProse } from '../fixtures/texts';
import { createWranglerProcess, type WranglerProcess } from './wrangler-process';

/** Default e2e camera: screen = world + (640, 400), zoom 1. */
const SX = 640;
const SY = 400;

/** Default text size preset is M (20 world px) at line-height 1.3. */
const LINE_HEIGHT_PX = 20 * 1.3;

interface ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text: string;
  z: number;
  size?: string;
  widthMode?: 'auto' | 'fixed';
}

async function getObjects(page: Page): Promise<Map<string, ObjectInfo>> {
  const list = await page.evaluate(() =>
    (window as unknown as { __vidi6: { getObjects(): ObjectInfo[] } }).__vidi6.getObjects(),
  );
  return new Map(list.map((o) => [o.id, o]));
}

/** The text objects on the page (in z order). */
async function getTexts(page: Page): Promise<ObjectInfo[]> {
  return [...(await getObjects(page)).values()].filter((o) => o.type === 'text');
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

/**
 * Arm the Text tool, click at screen (sx, sy) to create a text there, type
 * `text` into the editor and press Escape (commits, keeps the text selected).
 */
async function createText(page: Page, sx: number, sy: number, text: string): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(sx, sy);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor({ state: 'visible', timeout: 10000 });
  await editor.fill(text);
  await page.keyboard.press('Escape');
}

/** Wait until every context sees exactly `total` objects. */
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

/** Shift + drag from (x1,y1) to (x2,y2) (the marquee). */
async function shiftDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Move the object under the pointer at (x, y) by (dx, dy) screen px. */
async function dragAt(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

/** Drag the selection handle named `label` (e.g. 'Resize right') by (dx, dy). */
async function dragHandle(page: Page, label: string, dx: number, dy: number): Promise<void> {
  const handle = page.getByRole('button', { name: label });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`handle "${label}" not found`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

/** Skip a test unless it is running in chromium (TC-27 to TC-31). */
function chromiumOnly(): void {
  test.skip(test.info().project.name !== 'chromium', 'chromium-only');
}

const editorTestid = '[data-testid="text-editor"]';

test.describe('story 9: write free text anywhere on the board (wrangler)', () => {
  test('TC-26: a long annotation wraps to a 600-wide box with several lines', async ({ browser }) => {
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // T, click at world (0,0), type the 300-character fixture, Escape.
      await createText(page, SX, SY, makeProse(300));

      const texts = await getTexts(page);
      expect(texts).toHaveLength(1);
      const o = texts[0];
      expect(o.text).toHaveLength(300);

      // The auto width is capped at TEXT_MAX_AUTO_WIDTH_WORLD (±2 for engine
      // measurement differences), and the box spans several wrapped lines.
      await expect
        .poll(async () => {
          const t = (await getTexts(page))[0];
          const widthOk = Math.abs(t.width - TEXT_MAX_AUTO_WIDTH_WORLD) <= 2;
          const linesOk = t.height / LINE_HEIGHT_PX >= 3;
          return widthOk && linesOk;
        }, { timeout: 10000 })
        .toBe(true);
      const after = (await getTexts(page))[0];
      expect(Math.abs(after.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
      expect(after.height / LINE_HEIGHT_PX).toBeGreaterThanOrEqual(3);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-27: dragging the right handle narrows a text to a fixed width', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      await createText(page, SX, SY, makeProse(300));
      const before = (await getTexts(page))[0];
      expect(before.widthMode).toBe('auto');
      const initialHeight = before.height;

      // The single text shows only the east/west handles.
      expect(await page.getByRole('button', { name: 'Resize right' }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Resize left' }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Resize top' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Resize bottom' }).count()).toBe(0);

      // Drag the right handle 200px left: the box narrows and goes fixed.
      await dragHandle(page, 'Resize right', -200, 0);

      const after = (await getTexts(page))[0];
      expect(after.widthMode).toBe('fixed');
      expect(after.width).toBeLessThan(before.width);
      // Wrapping into a narrower column grows the box vertically.
      expect(after.height).toBeGreaterThan(initialHeight);

      // Still only horizontal handles for a single text.
      expect(await page.getByRole('button', { name: 'Resize right' }).count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Resize top' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Resize bottom' }).count()).toBe(0);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-28: golden path — XL heading, move, delete, undo restores it', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // Seed a small cluster of notes below where the heading will go, so the
      // heading can be moved "over" something (realism, not asserted).
      await page.evaluate(() => {
        const h = (window as unknown as {
          __vidi6: { createNoteAt(x: number, y: number, color: string, text: string): string };
        }).__vidi6;
        h.createNoteAt(-120, 220, 'yellow', 'shipped checkout');
        h.createNoteAt(40, 220, 'blue', 'pair earlier');
        h.createNoteAt(200, 220, 'green', 'drop the backlog item');
      });

      // Title a retro section: T, click above the cluster (world (40,-160)),
      // type the heading, Escape.
      const hx = 40 + SX;
      const hy = -160 + SY;
      await createText(page, hx, hy, 'Went well');

      let o = (await getTexts(page))[0];
      expect(o.text).toBe('Went well');
      expect(o.size).toBe('M');

      // The single selected text shows its size toolbar; bump it to XL.
      await page.getByRole('button', { name: 'Size XL' }).click();
      o = (await getTexts(page))[0];
      expect(o.size).toBe('XL');
      await expect
        .poll(async () => (await getTexts(page))[0].size, { timeout: 10000 })
        .toBe('XL');

      // Drag the heading down over the cluster (a plain move).
      const box = await page.locator('[data-testid="text-object"]').boundingBox();
      if (!box) throw new Error('text object not found');
      await dragAt(page, box.x + box.width / 2, box.y + box.height / 2, 0, 260);
      const moved = (await getTexts(page))[0];
      expect(moved.y).toBeCloseTo(o.y + 260, 0);

      // Delete the heading...
      await page.keyboard.press('Delete');
      await expect
        .poll(async () => (await getTexts(page)).length, { timeout: 10000 })
        .toBe(0);

      // ...and Ctrl+Z restores it (XL, at the moved position, same text).
      await page.keyboard.press('Control+z');
      await expect
        .poll(async () => (await getTexts(page)).length, { timeout: 10000 })
        .toBe(1);
      const restored = (await getTexts(page))[0];
      expect(restored.text).toBe('Went well');
      expect(restored.size).toBe('XL');
      expect(restored.y).toBeCloseTo(moved.y, 0);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-29: two contexts type into one text concurrently — they converge on every character', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);

      // A seeder creates one heading both editors will append to.
      const seederContext = await browser.newContext();
      ctxs.push(seederContext);
      const seeder = await seederContext.newPage();
      await openBoard(seeder, boardId);
      await createText(seeder, SX, SY, 'Head');
      const [head] = await getTexts(seeder);

      const aContext = await browser.newContext();
      ctxs.push(aContext);
      const a = await aContext.newPage();
      await openBoard(a, boardId);
      const bContext = await browser.newContext();
      ctxs.push(bContext);
      const b = await bContext.newPage();
      await openBoard(b, boardId);
      await waitAllSynced([seeder, a, b], 1);

      // Both open the same text for editing (caret lands at the end) and type
      // interleaved appends — a concurrent edit of the one Y.Text.
      const worldX = head.x + head.width / 2;
      const worldY = head.y + head.height / 2;
      const cx = worldX + SX;
      const cy = worldY + SY;

      await a.mouse.dblclick(cx, cy);
      await a.locator(editorTestid).waitFor({ state: 'visible', timeout: 10000 });
      await a.keyboard.type('al');

      await b.mouse.dblclick(cx, cy);
      await b.locator(editorTestid).waitFor({ state: 'visible', timeout: 10000 });
      await b.keyboard.type('be');

      await a.keyboard.type('pha');
      await b.keyboard.type('ta');

      await a.keyboard.press('Escape');
      await b.keyboard.press('Escape');

      // Both screens converge to the same text containing every character
      // (base "Head" + "alpha" + "beta" = 13 characters, none lost or doubled).
      const EXPECTED_LEN = 'Head'.length + 'alpha'.length + 'beta'.length;
      await expect
        .poll(async () => {
          const [ra, rb] = await Promise.all([getTexts(a), getTexts(b)]);
          return ra.length === 1 && rb.length === 1 && ra[0].text === rb[0].text && ra[0].text.length === EXPECTED_LEN;
        }, { timeout: 20000 })
        .toBe(true);
      const finalText = (await getTexts(a))[0].text;
      // Multiset equality: every typed character is present, none lost, none
      // duplicated — regardless of how the CRDT interleaved the two appends.
      const sorted = (s: string) => s.split('').sort().join('');
      expect(finalText).toHaveLength(EXPECTED_LEN);
      expect(sorted(finalText)).toBe(sorted('Head' + 'alpha' + 'beta'));
      expect(finalText).toContain('Head');

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-30: everyone adds a heading at once — all headings appear on every screen', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);

      const editors: Page[] = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const ctx = await browser.newContext();
        ctxs.push(ctx);
        const page = await ctx.newPage();
        await openBoard(page, boardId);
        editors.push(page);
      }

      // Each context creates its own heading at a distinct column via the
      // Text tool. Interleave the steps (rounds) so the creations overlap.
      const cols = [-480, -240, 0, 240, 480];
      const headings = cols.map((_, i) => `Heading ${i}`);
      const steps: Array<() => Promise<void>> = [];
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
        const page = editors[i];
        const sx = cols[i] + SX;
        const sy = SY;
        steps.push(async () => {
          await page.keyboard.press('t');
          await page.mouse.click(sx, sy);
          const editor = page.locator(editorTestid);
          await editor.waitFor({ state: 'visible', timeout: 10000 });
          await editor.fill(headings[i]);
          await page.keyboard.press('Escape');
        });
      }
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) await steps[i]();

      // Every context sees all MAX_CONCURRENT_EDITORS headings.
      await waitAllSynced(editors, MAX_CONCURRENT_EDITORS);
      for (const page of editors) {
        const texts = await getTexts(page);
        expect(texts).toHaveLength(MAX_CONCURRENT_EDITORS);
        const seen = texts.map((t) => t.text).sort();
        expect(seen).toEqual([...headings].sort());
      }

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });

  test('TC-31: abandoned text (T, click, Escape, no typing) leaves nothing selectable', async ({ browser }) => {
    chromiumOnly();
    const ctxs: BrowserContext[] = [];
    const wrangler = await createWranglerProcess();
    await wrangler.start();
    try {
      const boardId = await createBoard(wrangler.base);
      const ctx = await browser.newContext();
      ctxs.push(ctx);
      const page = await ctx.newPage();
      await openBoard(page, boardId);

      // Arm the Text tool, click to create an (empty) text, then Escape
      // without typing anything.
      await page.keyboard.press('t');
      await page.mouse.click(SX, SY);
      const editor = page.locator(editorTestid);
      await editor.waitFor({ state: 'visible', timeout: 10000 });
      await page.keyboard.press('Escape');

      // The empty text is removed: no objects remain on the board.
      await expect
        .poll(async () => (await getObjects(page)).size, { timeout: 10000 })
        .toBe(0);

      // A marquee over the spot selects nothing.
      await shiftDrag(page, SX - 100, SY - 60, SX + 100, SY + 60);
      await expect
        .poll(async () => page.locator('[data-testid="selection-overlay"]').count(), { timeout: 10000 })
        .toBe(0);

      for (const c of ctxs) await c.close();
    } finally {
      await Promise.all(ctxs.map((c) => c.close().catch(() => undefined)));
      await wrangler.dispose();
    }
  });
});
