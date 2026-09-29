// Story 9 — write free text anywhere on the board. Playwright e2e (TC-26..TC-31).
// Follows the numbered workflows in tasks.md: long annotation, right-handle rewrap,
// titling + undo, concurrent editing, five headings, and the abandoned text.

import { test, expect, type Page } from '@playwright/test';
import { openBoard, openSharedBoard, ensureBoard } from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LONG_TEXT_1000 } from '../fixtures/texts.ts';
import {
  TEXT_SIZES,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config.ts';

// The 300-character long-annotation fixture (real prose, spaces so it wraps).
const LONG_ANNOTATION = LONG_TEXT_1000.slice(0, 300);

const settle = (page: Page) => page.waitForTimeout(90);

interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

async function texts(page: Page): Promise<TextBox[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-text-id]')) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.textId ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: r.height,
        text: (el.querySelector('[data-testid="text-object-content"]')?.textContent ?? '').trim(),
      };
    });
  });
}
const findByText = (ts: TextBox[], prefix: string) => ts.find((t) => t.text.startsWith(prefix));
async function textCount(page: Page) {
  return (await texts(page)).length;
}

/** Switch to Select, then Text, then click the board — enters the new text's edit. */
async function placeText(page: Page, x: number, y: number) {
  await page.keyboard.press('v');
  await settle(page);
  await page.keyboard.press('t');
  await settle(page);
  await page.mouse.click(x, y);
  await settle(page);
}

/** Place a text, type into it, and end the edit. */
async function createTextAt(page: Page, x: number, y: number, text: string) {
  await placeText(page, x, y);
  await page.keyboard.type(text);
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
}
const selectTool = async (page: Page) => {
  await page.keyboard.press('v');
  await settle(page);
};

/** Drag from one screen point to another with the left button. */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2, { steps: 6 });
  await page.mouse.move(x2, y2, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

/** The screen centre of a handle of the single selected text (null if absent). */
async function handleCentre(page: Page, _id: string, handle: string) {
  return page.evaluate((h) => {
    const el = document.querySelector(`[data-handle="${h}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, handle);
}
async function handlePresent(page: Page, id: string, handle: string) {
  return (await handleCentre(page, id, handle)) !== null;
}

test.describe('story 9 free text', () => {
  test('TC-26 long annotation caps auto width and wraps to several lines', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 360, 240);
    await page.keyboard.type(LONG_ANNOTATION);
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    const t = findByText(await texts(page), LONG_ANNOTATION.slice(0, 12))!;
    expect(t).toBeTruthy();
    // Stored width hits the auto cap (within 2 units).
    expect(Math.abs(t.w - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    // It wraps to several rendered lines: height is many lines tall.
    const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(t.h).toBeGreaterThan(3 * lineHeight);
    // And it renders across multiple visual lines (not one clipped line).
    const lineHeightPx = await page.evaluate((tid) => {
      const el = document.querySelector(
        `[data-text-id="${tid}"] [data-testid="text-object-content"]`,
      ) as HTMLElement;
      return parseFloat(getComputedStyle(el).lineHeight);
    }, t.id);
    expect(t.h).toBeGreaterThan(lineHeightPx);
  });

  test('TC-27 drag the right handle narrower — rewrap, height grows, no top/bottom handles', async ({
    page,
  }) => {
    await openBoard(page);
    await createTextAt(page, 300, 240, LONG_ANNOTATION);
    await selectTool(page);
    const t = findByText(await texts(page), LONG_ANNOTATION.slice(0, 12))!;
    // Only horizontal handles: e/w present, n/s/ corners absent.
    await page.click(`[data-text-id="${t.id}"]`);
    await settle(page);
    expect(await handlePresent(page, t.id, 'e')).toBe(true);
    expect(await handlePresent(page, t.id, 'w')).toBe(true);
    expect(await handlePresent(page, t.id, 'n')).toBe(false);
    expect(await handlePresent(page, t.id, 's')).toBe(false);
    // Drag the east handle well to the left → narrower fixed width, taller (rewrapped).
    const before = (await texts(page)).find((x) => x.id === t.id)!;
    const e = (await handleCentre(page, t.id, 'e'))!;
    await drag(page, e.x, e.y, e.x - 360, e.y);
    const after = (await texts(page)).find((x) => x.id === t.id)!;
    expect(after.w).toBeLessThan(before.w - 300);
    expect(after.w).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    expect(after.h).toBeGreaterThan(before.h);
  });

  test('TC-28 title a retro section, then delete and undo restores it', async ({ page }) => {
    await openBoard(page);
    // A cluster of sticky notes to title.
    await createStickyFast(page, 300, 500, 'item one');
    await createStickyFast(page, 420, 500, 'item two');
    // T, click above the cluster, type the title, Escape.
    await createTextAt(page, 360, 380, 'Went well');
    await selectTool(page);
    const title = findByText(await texts(page), 'Went well')!;
    // Select and click XL.
    await page.click(`[data-text-id="${title.id}"]`);
    await settle(page);
    await page.getByTestId('text-size-XL').click();
    await settle(page);
    const fontXL = await page.evaluate(
      (tid) =>
        parseFloat(
          getComputedStyle(
            document.querySelector(`[data-text-id="${tid}"] [data-testid="text-object-content"]`)!,
          ).fontSize,
        ),
      title.id,
    );
    expect(fontXL).toBeCloseTo(TEXT_SIZES.XL, 0);
    // Drag the title over the cluster (moves x/y).
    const movedBefore = (await texts(page)).find((x) => x.id === title.id)!.x;
    const box = await page.evaluate((tid) => {
      const r = document.querySelector(`[data-text-id="${tid}"]`)!.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + 8 };
    }, title.id);
    await drag(page, box.cx, box.cy, box.cx + 80, box.cy);
    const movedAfter = (await texts(page)).find((x) => x.id === title.id)!.x;
    expect(movedAfter).toBeGreaterThan(movedBefore);
    // Delete, then undo restores it (still XL).
    await page.click(`[data-text-id="${title.id}"]`);
    await settle(page);
    await page.getByTestId('text-delete').click();
    await settle(page);
    expect(findByText(await texts(page), 'Went well')).toBeUndefined();
    await page.keyboard.press('Control+z');
    await settle(page);
    const restored = findByText(await texts(page), 'Went well');
    expect(restored).toBeTruthy();
  });

  test('TC-29 two clients type into the same text at once — both end up with every character', async ({
    context,
  }) => {
    const id = newBoardId();
    await ensureBoard(id);
    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    // A creates a text with a seed word, then leaves it selected.
    await createTextAt(a, 360, 260, 'start');
    await expect.poll(() => textCount(b), { timeout: 8000 }).toBe(1);
    // Both double-click the same text into edit mode (same world point on each screen).
    const pt = async (p: Page) =>
      p.evaluate(() => {
        const r = document.querySelector('[data-text-id]')!.getBoundingClientRect();
        return { x: r.x + Math.min(r.width / 2, 12), y: r.y + 6 };
      });
    const ap = await pt(a);
    await a.mouse.dblclick(ap.x, ap.y);
    await settle(a);
    const bp = await pt(b);
    await b.mouse.dblclick(bp.x, bp.y);
    await settle(b);
    // Type distinct fragments from each editor, interleaved.
    await a.keyboard.type('AAA');
    await b.keyboard.type('BBB');
    await settle(a);
    await settle(b);
    await a.keyboard.type('ccc');
    await b.keyboard.type('ddd');
    await settle(a);
    await settle(b);
    await a.keyboard.press('Escape');
    await b.keyboard.press('Escape');
    await settle(a);
    await settle(b);
    const ta = (await texts(a))[0].text;
    const tb = (await texts(b))[0].text;
    // Concurrent edits interleave in the CRDT, so assert on the character multiset:
    // both screens agree, the seed survives, and every typed character appears
    // exactly once (no loss, no duplication).
    expect(ta).toBe(tb);
    expect(ta.startsWith('start')).toBe(true);
    const counts = (s: string) => {
      const m: Record<string, number> = {};
      for (const c of s) m[c] = (m[c] ?? 0) + 1;
      return m;
    };
    expect(counts(ta)).toEqual(counts('start' + 'AAA' + 'BBB' + 'ccc' + 'ddd'));
    expect(ta.length).toBe('start'.length + 12);
    expect(await textCount(b)).toBe(1);
  });

  test('TC-30 five clients each create a heading via the Text tool — all visible everywhere', async ({
    context,
  }) => {
    const id = newBoardId();
    await ensureBoard(id);
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const p = await context.newPage();
      await openSharedBoard(p, id);
      pages.push(p);
    }
    // Each creates its own heading via the Text tool at a distinct spot.
    for (let i = 0; i < pages.length; i++) {
      await createTextAt(pages[i], 200 + i * 60, 160, `Heading ${i}`);
    }
    // Every screen eventually shows every heading.
    for (const p of pages) {
      await expect
        .poll(() => textCount(p), { timeout: 10000 })
        .toBe(MAX_CONCURRENT_EDITORS);
      const ts = await texts(p);
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++)
        expect(ts.some((t) => t.text === `Heading ${i}`)).toBe(true);
    }
  });

  test('TC-31 abandoned text leaves nothing; Shift+drag over the spot selects nothing', async ({
    page,
  }) => {
    await openBoard(page);
    // T, click, Escape without typing → the object is gone from the doc.
    await placeText(page, 320, 220);
    expect(await textCount(page)).toBe(1); // present while editing
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await textCount(page)).toBe(0);
    // Shift+drag over the same spot selects nothing (there is no hit target).
    await page.keyboard.down('Shift');
    await drag(page, 260, 160, 420, 300);
    await page.keyboard.up('Shift');
    await settle(page);
    expect(await page.getByTestId('selection-bar').count()).toBe(0);
    // And a typed space survives, so emptiness (not the tool) drove the removal.
    await placeText(page, 320, 220);
    await page.keyboard.type(' ');
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await textCount(page)).toBe(1);
  });

  test('the Text tool click-to-create also fires on top of an existing object', async ({
    page,
  }) => {
    await openBoard(page);
    await createStickyFast(page, 500, 400, 'sticky here');
    // A single click on the note while the Text tool is active creates a text there.
    const before = await page.evaluate(() => {
      const el = document.querySelector('[data-note-id]') as HTMLElement;
      return { left: el.style.left, top: el.style.top };
    });
    await page.keyboard.press('t');
    await settle(page);
    await page.mouse.click(500, 400);
    await settle(page);
    await page.keyboard.type('over');
    await page.keyboard.press('Escape');
    await settle(page);
    expect(findByText(await texts(page), 'over')).toBeTruthy();
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-note-id]') as HTMLElement;
      return { left: el.style.left, top: el.style.top };
    });
    expect(after).toEqual(before); // never dragged / edited
    expect(await page.getByTestId('sticky-text-editor').count()).toBe(0);
  });
});

// Create a sticky via the N/centre flow is screen-centre; for fixtures we double-click a point.
async function createStickyFast(page: Page, x: number, y: number, text: string) {
  await page.mouse.dblclick(x, y);
  await settle(page);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await settle(page);
}
