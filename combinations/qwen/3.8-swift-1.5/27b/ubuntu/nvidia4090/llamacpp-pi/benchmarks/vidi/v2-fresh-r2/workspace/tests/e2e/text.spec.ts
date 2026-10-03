/**
 * E2E tests for story 9: write free text anywhere on the board
 * (TC-26 to TC-31).
 *
 * Real-browser proof of the Text tool (text.tool_ui) and text objects
 * (text.object) with real fonts and the real sync server. The camera is
 * normalised per test to {x: -640, y: -400, zoom: 1}, so world (0,0) is at
 * screen (640, 400) and screen = world + (640, 400).
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createBoardAndOpen, setCamera } from './helpers/board';
import { openParticipants, expectEventually } from './helpers/participants';
import { LONG_ANNOTATION } from '../fixtures/texts';
import { TEXT_MAX_AUTO_WIDTH_WORLD, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const TEXT = '[data-testid="text-object"]';
const TEXTAREA = '[data-testid="text-editor-textarea"]';

/** Screen coordinates of world (0,0) at the normalised camera. */
const ORIGIN = { x: 640, y: 400 };

/** Activate the Text tool (T). */
async function pressT(page: Page): Promise<void> {
  await page.keyboard.press('t');
}

/** Click a screen point to create a text object (Text tool must be active). */
async function clickToCreateText(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
  await page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 5000 });
}

/** Type into the open text editor and end editing (Escape). */
async function typeAndFinish(page: Page, text: string): Promise<void> {
  const ta = page.locator(TEXTAREA);
  await ta.fill(text);
  await page.keyboard.press('Escape');
}

/** Inline-style world geometry of the text objects (DOM order). */
async function textGeometry(
  page: Page,
): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-testid="text-object"]')].map((el) => {
      const s = (el as HTMLElement).style;
      return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
    });
  });
}

/** The display text of the text object at `index`. */
async function textContent(page: Page, index: number): Promise<string> {
  return (await page.locator(TEXT).nth(index).locator('[data-testid="text-display"]').textContent()) ?? '';
}

/** Shift+drag a marquee between two screen points. */
async function marqueeDrag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Insert a sticky centred on a world point (test build hook). */
async function insertSticky(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(async ({ x, y }) => {
    const hook = (window as { __vidi6?: { insertSticky?: (x: number, y: number) => string } }).__vidi6;
    if (!hook?.insertSticky) throw new Error('insertSticky hook missing (not a test build?)');
    return hook.insertSticky(x, y);
  }, { x, y });
}

test.describe('story 9 e2e', () => {
  test.beforeEach(async ({ page }) => {
    await createBoardAndOpen(page);
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
  });

  // TC-26: a long annotation wraps at the max auto width into several lines.
  test('TC-26: a 300-character annotation wraps at the max auto width', async ({ page }) => {
    await pressT(page);
    await clickToCreateText(page, ORIGIN.x, ORIGIN.y);
    await typeAndFinish(page, LONG_ANNOTATION);

    const [box] = await textGeometry(page);
    expect(box).toBeTruthy();
    // The box wraps at the max auto width (a 300-char paragraph fills it): the
    // longest line reaches the cap, so the stored width is at the max within a
    // small font-metric band (cross-browser wrapping differences).
    expect(box.w).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(box.w).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 20);
    // Several rendered lines: at M (20px, line-height 1.3 = 26/line) the
    // annotation spans well more than three lines.
    expect(box.h).toBeGreaterThan(3 * 26);
  });

  // TC-27: dragging the right handle narrower rewraps and grows the height;
  // there are no top/bottom handles.
  test('TC-27: narrowing the right handle rewraps and grows the height', async ({ page }) => {
    await pressT(page);
    await clickToCreateText(page, ORIGIN.x - 200, ORIGIN.y - 60);
    // A ~200-char annotation: several lines at the max width, more when narrowed.
    await typeAndFinish(page, LONG_ANNOTATION.slice(0, 200));

    const before = (await textGeometry(page))[0];
    expect(before).toBeTruthy();

    // Select the text.
    await page.mouse.click(before.x + 640, before.y + 400);
    // Only horizontal handles are present.
    expect(await page.locator('[data-testid="resize-handle-e"]').count()).toBe(1);
    expect(await page.locator('[data-testid="resize-handle-w"]').count()).toBe(1);
    expect(await page.locator('[data-testid="resize-handle-n"]').count()).toBe(0);
    expect(await page.locator('[data-testid="resize-handle-s"]').count()).toBe(0);
    expect(await page.locator('[data-testid="resize-handle-nw"]').count()).toBe(0);
    expect(await page.locator('[data-testid="resize-handle-se"]').count()).toBe(0);

    // Drag the east handle left by 120 screen px (zoom 1 → 120 world units).
    const east = page.locator('[data-testid="resize-handle-e"]');
    const ebox = (await east.boundingBox())!;
    await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
    await page.mouse.down();
    await page.mouse.move(ebox.x - 120, ebox.y + ebox.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await textGeometry(page))[0];
    expect(after.w).toBeLessThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);
  });

  // TC-28: title a retro section — create, size XL, move with the cluster,
  // delete, then undo restores it.
  test('TC-28: title a retro section, move it, delete and undo', async ({ page }) => {
    // A cluster of three sticky notes around the origin (via the test hook).
    await insertSticky(page, -100, 60);
    await insertSticky(page, 100, 60);
    await insertSticky(page, 0, 160);

    // Title the section above the cluster.
    await pressT(page);
    await clickToCreateText(page, ORIGIN.x - 100, ORIGIN.y - 150);
    await typeAndFinish(page, 'Went well');
    const titleBefore = (await textGeometry(page))[0];
    expect(titleBefore).toBeTruthy();

    // Size it XL.
    await page.mouse.click(titleBefore.x + 640, titleBefore.y + 400);
    await page.locator('[data-testid="text-size-XL"]').click();

    // Select the title + cluster (a marquee that fully contains all four) and
    // drag them together (grabbing the title).
    await marqueeDrag(page, 380, 200, 960, 720);
    expect(await page.locator('[data-selected]').count()).toBe(4);
    // Move the whole selection with the title (+150 x, +60 y). Shift+arrow
    // nudges by 10 world units each (cross-browser reliable).
    for (let i = 0; i < 15; i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowDown');
    const moved = (await textGeometry(page))[0];
    expect(moved.x - titleBefore.x).toBeCloseTo(150, 0);

    // Delete just the title, then undo to restore it.
    await page.mouse.click(moved.x + 640, moved.y + 400);
    await page.keyboard.press('Delete');
    expect(await page.locator(TEXT).count()).toBe(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator(TEXT)).toHaveCount(1);
  });

  // TC-29: two participants type into the same text → identical merged text
  // containing every character. A types first; B opens the text once A's
  // characters have synced (so B appends) and types too.
  test('TC-29: two participants type into the same text simultaneously', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, 2);
    try {
      // A creates a text and types a prefix (editor stays open).
      await a.page.keyboard.press('t');
      await a.page.mouse.click(ORIGIN.x, ORIGIN.y);
      await a.page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 5000 });
      await a.page.locator(TEXTAREA).type('Hello');

      // Wait until B sees the text with A's characters.
      await expectEventually(
        async () => ((await b.page.locator('[data-testid="text-display"]').textContent()) ?? '').includes('Hello'),
        'B sees A\'s text',
      );

      // B opens the same text for editing (B's editor starts from A's text).
      await b.page.locator(TEXT).dblclick();
      await b.page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 5000 });
      // B appends.
      await b.page.locator(TEXTAREA).type('World');

      await a.page.keyboard.press('Escape');
      await b.page.keyboard.press('Escape');

      // Both converge on a text containing every character.
      await expectEventually(
        async () => {
          const ta = (await a.page.locator('[data-testid="text-display"]').textContent()) ?? '';
          const tb = (await b.page.locator('[data-testid="text-display"]').textContent()) ?? '';
          return (
            ['H', 'e', 'l', 'o', 'W', 'r', 'd'].every((c) => ta.includes(c)) &&
            ['H', 'e', 'l', 'o', 'W', 'r', 'd'].every((c) => tb.includes(c)) &&
            ta === tb
          );
        },
        'both participants see the same merged text',
      );
    } finally {
      await a.close();
      await b.close();
    }
  });

  // TC-30: MAX_CONCURRENT_EDITORS participants each create a heading at once.
  test(`TC-30: ${MAX_CONCURRENT_EDITORS} participants create headings simultaneously`, async ({ browser }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const parts = await openParticipants(browser, n);
    try {
      // Each participant creates a heading at a distinct point via the Text tool.
      await Promise.all(
        parts.map(async (p, i) => {
          await p.page.keyboard.press('t');
          await p.page.mouse.click(ORIGIN.x - 300 + i * 120, ORIGIN.y);
          await p.page.locator(TEXTAREA).waitFor({ state: 'visible', timeout: 5000 });
          await p.page.locator(TEXTAREA).fill(`Heading ${i + 1}`);
          await p.page.keyboard.press('Escape');
        }),
      );

      // Every participant sees all n headings.
      for (const p of parts) {
        await expectEventually(async () => (await p.page.locator(TEXT).count()) === n, `${p.name} sees all headings`);
      }
      // And the content matches on every screen.
      for (const p of parts) {
        for (let i = 1; i <= n; i++) {
          await expectEventually(
            async () => {
              const all = await p.page.locator(TEXT).allTextContents();
              return all.some((t) => t.includes(`Heading ${i}`));
            },
            `${p.name} sees Heading ${i}`,
          );
        }
      }
    } finally {
      for (const p of parts) await p.close();
    }
  });

  // TC-31: abandoned text — T, click, Escape without typing → nothing stored.
  test('TC-31: abandoning a text stores nothing and selects nothing', async ({ page }) => {
    await pressT(page);
    await clickToCreateText(page, ORIGIN.x, ORIGIN.y);
    // Escape without typing.
    await page.keyboard.press('Escape');

    // No text object in the doc.
    await expect(page.locator(TEXT)).toHaveCount(0);

    // A marquee over the spot selects nothing.
    await marqueeDrag(page, ORIGIN.x - 100, ORIGIN.y - 100, ORIGIN.x + 100, ORIGIN.y + 100);
    expect(await page.locator('[data-selected]').count()).toBe(0);
  });
});
