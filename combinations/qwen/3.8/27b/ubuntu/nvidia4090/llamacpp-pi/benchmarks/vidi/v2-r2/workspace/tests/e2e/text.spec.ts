import { expect, test, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { longAnnotation } from '../fixtures/texts';
import { settle } from './helpers/board';
import {
  Participant,
  createBoard,
  sharedServerUrl,
} from './helpers/participants';

/**
 * E2E free text for story 9 (design "E2E workflows"):
 *
 *   TC-26: T, click, type a 300-char annotation -> the box grows to the
 *          600-unit cap and wraps into multiple lines (text.wrap).
 *   TC-27: dragging the east handle narrower sets a fixed width; the words
 *          wrap and the height grows; only horizontal handles exist
 *          (text.fixed_width, text.resize).
 *   TC-28: golden path — XL heading, move, Delete, one Ctrl+Z restores
 *          (text.object).
 *   TC-29: two people type into one text at once; both boards converge on
 *          identical text containing every character (live).
 *   TC-30: MAX_CONCURRENT_EDITORS participants create headings at once;
 *          every screen shows all of them (live).
 *   TC-31: T, click, Escape without typing -> no object in the doc; a
 *          marquee over the spot selects nothing (text.empty_removed).
 *
 * Default camera (1280x800 viewport): screen = world + (640, 400) at zoom 1.
 * Model state is read through the test-only window.__vidi6 hook.
 */

interface TextObj {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  width?: number;
  height?: number;
  size?: string;
  widthMode?: 'auto' | 'fixed';
}

async function objects(page: Page): Promise<TextObj[]> {
  return page.evaluate(() => (window.__vidi6?.getObjects() ?? []) as TextObj[]);
}

/** Wait until the board reports connected (edits sync in the live tests). */
async function waitConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__vidi6?.connectionState === 'connected',
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/** Press T, click at a screen point, and wait for the text editor. */
async function startText(page: Page, sx: number, sy: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(sx, sy);
  await page.getByTestId('text-textarea').waitFor({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const boardId = await createBoard(sharedServerUrl());
  await page.goto(`/b/${encodeURIComponent(boardId)}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
  await waitConnected(page);
});

test.describe('text.e2e', () => {
  test('TC-26: a 300-char annotation grows to the 600 cap and wraps to multiple lines (text.wrap)', async ({
    page,
  }) => {
    await startText(page, 640, 400);
    await page.keyboard.type(longAnnotation());

    // The box reaches the auto-width cap (±2 for measurement rounding).
    await page.waitForFunction(
      ({ text, cap }) => {
        const o = window.__vidi6?.getObjects() ?? [];
        return (
          o.length === 1 &&
          o[0].text.length === text.length &&
          (o[0].width ?? 0) >= cap - 2
        );
      },
      { text: longAnnotation(), cap: TEXT_MAX_AUTO_WIDTH_WORLD },
      { timeout: 10_000 },
    );
    const obj = (await objects(page))[0];
    expect(obj.text).toBe(longAnnotation());
    expect(obj.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(obj.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    // Multiple rendered lines: the box is taller than two M-size lines.
    expect(obj.height).toBeGreaterThan(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);

    // Ending the edit keeps the text and its measured box.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('text-textarea')).toHaveCount(0);
    const after = (await objects(page))[0];
    expect(after.text).toBe(longAnnotation());
    expect(after.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(page.locator('[data-testid="text-object"]')).toHaveCount(1);
  });

  test('TC-27: dragging the east handle narrower sets a fixed width; words wrap and the height grows (text.fixed_width)', async ({
    page,
  }) => {
    const phrase = 'The quick brown fox jumps over the lazy dog';
    await startText(page, 640, 400);
    await page.keyboard.type(phrase);
    await page.waitForFunction(
      (min) => {
        const o = window.__vidi6?.getObjects() ?? [];
        return o.length === 1 && (o[0].width ?? 0) > min;
      },
      TEXT_MIN_WIDTH_WORLD,
      { timeout: 10_000 },
    );
    const before = (await objects(page))[0];
    const heightBefore = before.height ?? 0;

    // Escape keeps the text selected; the east handle sits on its right edge.
    await page.keyboard.press('Escape');
    const startX = 640 + before.x + (before.width ?? TEXT_MIN_WIDTH_WORLD);
    const startY = 400 + before.y + (before.height ?? 0) / 2;
    // Drag left past the minimum width: the clamp lands exactly on it.
    const dragBy = (before.width ?? TEXT_MIN_WIDTH_WORLD) - TEXT_MIN_WIDTH_WORLD + 40;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - dragBy, startY, { steps: 8 });
    await page.mouse.up();
    await settle(page);

    const after = (await objects(page))[0];
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD - 0.01);
    expect(after.width).toBeLessThanOrEqual(TEXT_MIN_WIDTH_WORLD + 0.01);
    // The same words now wrap into more lines at the narrow width.
    expect(after.height).toBeGreaterThan(heightBefore);
    // Only horizontal handles exist for a single text selection.
    const handles = page.locator('[data-testid="resize-handle"]');
    expect(await handles.count()).toBe(2);
    const labels = await handles.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-handle')),
    );
    expect(labels.sort()).toEqual(['e', 'w']);
    expect(after.text).toBe(phrase);
  });

  test('TC-28: golden path — XL heading, move, delete, one undo restores it (text.object)', async ({
    page,
  }) => {
    const heading = 'Retro heading';
    await startText(page, 640, 400);
    await page.keyboard.type(heading);
    await page.keyboard.press('Escape'); // stays selected

    // XL size preset.
    await page.getByTestId('text-size-xl').click();
    await page.waitForFunction(
      () => {
        const o = window.__vidi6?.getObjects() ?? [];
        return o.length === 1 && o[0].size === 'XL';
      },
      undefined,
      { timeout: 5_000 },
    );
    const sized = (await objects(page))[0];
    expect(sized.size).toBe('XL');

    // Move it by (50, 30).
    const cx = 640 + sized.x + (sized.width ?? TEXT_MIN_WIDTH_WORLD) / 2;
    const cy = 400 + sized.y + (sized.height ?? 0) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy + 30, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const moved = (await objects(page))[0];
    expect(moved.x).toBeCloseTo(sized.x + 50, 0);
    expect(moved.y).toBeCloseTo(sized.y + 30, 0);

    // Delete it, then one undo step restores it at its moved position.
    await page.keyboard.press('Delete');
    await page.waitForFunction(
      () => (window.__vidi6?.getObjects() ?? []).length === 0,
      undefined,
      { timeout: 5_000 },
    );
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () => (window.__vidi6?.getObjects() ?? []).length === 1,
      undefined,
      { timeout: 5_000 },
    );
    const restored = (await objects(page))[0];
    expect(restored.text).toBe(heading);
    expect(restored.size).toBe('XL');
    expect(restored.x).toBeCloseTo(moved.x, 0);
    expect(restored.y).toBeCloseTo(moved.y, 0);
  });

  test('TC-29: two people type into one text at once; both boards converge with all characters (live)', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const boardId = await createBoard(sharedServerUrl());
    const a = await Participant.join(context, boardId);
    const b = await Participant.join(context, boardId);

    // A creates a text at world (0,0) and stays in edit mode …
    await a.page.keyboard.press('t');
    await a.page.mouse.click(640, 400);
    await a.page.getByTestId('text-textarea').waitFor({ timeout: 5_000 });
    // … and B opens the same object for editing (double-click).
    await b.page.waitForSelector('[data-testid="text-object"]');
    await b.page.mouse.dblclick(660, 413);
    await b.page.getByTestId('text-textarea').waitFor({ timeout: 5_000 });

    // Both type at once; the CRDT merges every character on both sides.
    await Promise.all([
      a.page.keyboard.type('Hello '),
      b.page.keyboard.type('world'),
    ]);
    await a.waitFor(
      (objs) => objs.length === 1 && objs[0].text.length >= 11,
      'A to hold all 11 characters',
    );
    await b.waitFor(
      (objs) => objs.length === 1 && objs[0].text.length >= 11,
      'B to hold all 11 characters',
    );
    const textA = (await a.objects())[0].text;
    const textB = (await b.objects())[0].text;
    // Identical on both boards …
    expect(textA).toBe(textB);
    // … containing every character of what was typed.
    const chars = (s: string): string => [...s].sort().join('');
    expect(chars(textA)).toBe(chars('Hello world'));
    expect(a.hasErrors()).toBe(false);
    expect(b.hasErrors()).toBe(false);
  });

  test('TC-30: five participants create headings at once; every screen shows all of them (live)', async ({
    browser,
  }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const boardId = await createBoard(sharedServerUrl());
    const parts = await Promise.all(
      Array.from({ length: n }, () => Participant.join(context, boardId)),
    );
    const headings = Array.from({ length: n }, (_, i) => `Heading ${i + 1}`);

    // Everyone arms the Text tool and clicks a distinct spot at once.
    await Promise.all(
      parts.map(async (p, i) => {
        await p.page.keyboard.press('t');
        await p.page.mouse.click(240 + i * 160, 320);
        await p.page.getByTestId('text-textarea').waitFor({ timeout: 8_000 });
        await p.page.keyboard.type(headings[i]);
        await p.page.keyboard.press('Escape');
      }),
    );

    // Every screen shows all n headings.
    for (const p of parts) {
      const objs = await p.waitFor(
        (o) => o.length === n && headings.every((h) => o.some((x) => x.text === h)),
        `all ${n} headings`,
      );
      expect(objs).toHaveLength(n);
    }
    for (const p of parts) {
      expect(p.hasErrors()).toBe(false);
    }
  });

  test('TC-31: escaping without typing leaves no object; a marquee over the spot selects nothing (text.empty_removed)', async ({
    page,
  }) => {
    await startText(page, 640, 400);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('text-textarea')).toHaveCount(0);
    await expect.poll(async () => (await objects(page)).length).toBe(0);
    await expect(page.locator('[data-testid="text-object"]')).toHaveCount(0);

    // Marquee over the creation area: nothing to select.
    await page.keyboard.down('Shift');
    await page.mouse.move(580, 360);
    await page.mouse.down();
    await page.mouse.move(760, 460, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);
    await expect(page.locator('[data-testid="resize-handle"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});
