// Story 9 e2e: free text anywhere on the board (TC-26 to TC-31).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium, Firefox
// and WebKit. Participants are genuine y-websocket clients of the BoardRoom
// Durable Object; world state (text box dimensions, content) is read back from
// each participant's Y.Doc so camera rounding never matters. The Text tool,
// the text editor, the TextToolbar and the resize handles are driven through
// the real UI.

import { expect, test, type Page } from '@playwright/test';
import { TEXT_MAX_AUTO_WIDTH_WORLD, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { THREE_HUNDRED_CHAR_SENTENCE } from '../fixtures/texts';
import {
  closeParticipant,
  createFreshBoard,
  expectWithin,
  openParticipant,
  type Participant,
} from './helpers/participants';

/** The home camera of a page (100%, world origin centred). */
async function homeCam(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: -width / 2, y: -height / 2, zoom: 1 };
}

/** World (x,y) → screen px under a zoom-1 centred camera. */
function toScreen(cam: { x: number; y: number }, wx: number, wy: number): { x: number; y: number } {
  return { x: wx - cam.x, y: wy - cam.y };
}

interface WorldText {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  text: string;
}

/** The text objects in the page's Y.Doc, as plain world state. */
async function worldTexts(page: Page): Promise<WorldText[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldText[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'text') continue;
      out.push({
        id: String(key),
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number,
        height: o.get('height') as number,
        size: (o.get('size') as string) ?? 'M',
        text: (o.get('text') as { toString(): string } | undefined)?.toString() ?? '',
      });
    }
    return out;
  });
}

/** All objects in the page's Y.Doc (any type), counted by type. */
async function objectCountByType(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: Record<string, number> = {};
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      const t = o.get('type') as string;
      out[t] = (out[t] ?? 0) + 1;
    }
    return out;
  });
}

/** The text editor textarea, if mounted. */
function textEditor(page: Page) {
  return page.locator('[data-testid="text-editor"] textarea');
}

/** Activate the Text tool and click the board at world (wx, wy). */
async function createTextAt(page: Page, wx: number, wy: number): Promise<void> {
  const cam = await homeCam(page);
  await page.getByRole('button', { name: 'Text (T)' }).click();
  const { x, y } = toScreen(cam, wx, wy);
  await page.mouse.click(x, y);
}

/** Type into the mounted text editor. */
async function typeInText(page: Page, text: string): Promise<void> {
  await textEditor(page).pressSequentially(text, { delay: 5 });
}

/** End editing (Escape) — keeps a non-empty text selected. */
async function endEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/** The resize handle of the selection overlay for a given handle name. */
async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
): Promise<void> {
  const el = page.locator(`[data-handle="${handle}"]`);
  const box = (await el.boundingBox()) ?? undefined;
  if (box === undefined) throw new Error(`${handle} handle not rendered`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

/** Drag a text object (by index) by (dx, dy) screen pixels. */
async function dragText(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const el = page.locator('[data-testid="text-object"]').nth(index);
  const box = (await el.boundingBox()) ?? undefined;
  if (box === undefined) throw new Error('text has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

/** Count the rendered text lines of the text at index (height / line height). */
async function renderedLineCount(page: Page, index: number): Promise<number> {
  return page.locator('[data-testid="text-object"]').nth(index).evaluate((el) => {
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
    return Math.max(1, Math.round(el.clientHeight / line));
  });
}

test.describe('story 9 — free text', () => {
  test('TC-26 T, click, type a 300-char sentence → box width 600 ±2, multiple lines', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      await createTextAt(p.page, 0, 0);
      await typeInText(p.page, THREE_HUNDRED_CHAR_SENTENCE);
      await endEdit(p.page);

      const texts = await worldTexts(p.page);
      expect(texts).toHaveLength(1);
      // Auto width is clamped to the max (600) within ±2 units.
      expect(Math.abs(texts[0].width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
      // A 300-char sentence wraps to several lines (height > one line).
      expect(texts[0].height).toBeGreaterThan(40);
      expect(await renderedLineCount(p.page, 0)).toBeGreaterThan(1);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-27 drag the right handle narrower → rewrap, height grows, no top/bottom handles', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      await createTextAt(p.page, 0, 0);
      await typeInText(p.page, THREE_HUNDRED_CHAR_SENTENCE);
      await endEdit(p.page);
      // The single text is selected; only e/w handles exist.
      expect(p.page.locator('[data-handle="n"]')).toHaveCount(0);
      expect(p.page.locator('[data-handle="s"]')).toHaveCount(0);
      expect(p.page.locator('[data-handle="e"]')).toHaveCount(1);
      expect(p.page.locator('[data-handle="w"]')).toHaveCount(1);

      const before = (await worldTexts(p.page))[0];
      // Drag the east handle left (narrower): words rewrap, height grows.
      await dragHandle(p.page, 'e', -200, 0);
      const after = (await worldTexts(p.page))[0];
      expect(after.width).toBeLessThan(before.width);
      expect(after.height).toBeGreaterThan(before.height);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-28 golden path: XL heading, drag, Delete, Ctrl+Z restores', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      // Create a heading above a cluster (empty board, world origin area).
      await createTextAt(p.page, 0, -150);
      await typeInText(p.page, 'Went well');
      await endEdit(p.page);

      // Select it and set XL via the TextToolbar.
      const xl = p.page.getByRole('button', { name: 'Text size XL' });
      await expect(xl).toBeVisible();
      await xl.click();
      let texts = await worldTexts(p.page);
      expect(texts[0].size).toBe('XL');

      // Drag it (move) — the x moves, the size stays XL.
      await dragText(p.page, 0, 80, 40);
      texts = await worldTexts(p.page);
      expect(texts[0].x).toBeGreaterThan(0);
      expect(texts[0].size).toBe('XL');

      // Delete the selected text.
      await p.page.keyboard.press('Delete');
      expect((await objectCountByType(p.page)).text ?? 0).toBe(0);

      // Ctrl+Z restores it.
      await p.page.keyboard.press('Control+z');
      await expectWithin(async () => {
        const t = await worldTexts(p.page);
        return t.length === 1 && t[0].text === 'Went well' && t[0].size === 'XL';
      });
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-29 two participants type into one text simultaneously → all characters', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const a = await openParticipant(browser, boardId);
    const b = await openParticipant(browser, boardId);
    try {
      // A creates the text and types the first half.
      await createTextAt(a.page, 0, 0);
      await typeInText(a.page, 'alpha ');
      // B opens the same text (it has synced) and types the second half.
      await expectWithin(async () => (await worldTexts(b.page)).length === 1);
      await b.page.locator('[data-testid="text-object"]').first().dblclick();
      await typeInText(b.page, 'beta');
      await endEdit(b.page);

      // Both screens converge to the SAME text, and that text is a
      // character-for-character merge of both inputs (concurrent insertions
      // interleave, so we compare the character multiset, not substrings).
      const sorted = (s: string) =>
        [...s].sort().join('');
      const expected = sorted('alpha ' + 'beta');
      await expectWithin(async () => {
        const ta = await worldTexts(a.page);
        const tb = await worldTexts(b.page);
        return (
          ta.length === 1 &&
          tb.length === 1 &&
          ta[0].text === tb[0].text &&
          sorted(ta[0].text) === expected
        );
      });
    } finally {
      await closeParticipant(a);
      await closeParticipant(b);
    }
  });

  test('TC-30 MAX_CONCURRENT_EDITORS contexts each create a heading → all visible', async ({
    browser,
    request,
  }) => {
    test.setTimeout(90_000); // five genuine y-websocket clients + sync
    const boardId = await createFreshBoard(request);
    const participants: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      participants.push(await openParticipant(browser, boardId));
    }
    try {
      // Each context creates a heading at a distinct spot. Positions are
      // centred so all five land inside the 1280px viewport (world x
      // -500..500 → screen 140..1140 at the home camera).
      for (let i = 0; i < participants.length; i++) {
        await createTextAt(participants[i].page, i * 250 - 500, 0);
        await typeInText(participants[i].page, `Heading ${i + 1}`);
        await endEdit(participants[i].page);
      }

      // Every screen sees all MAX_CONCURRENT_EDITORS headings.
      for (const p of participants) {
        await expectWithin(async () => {
          const texts = await worldTexts(p.page);
          return texts.length === MAX_CONCURRENT_EDITORS;
        });
      }
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });

  test('TC-31 T, click, Escape without typing → no object; marquee selects nothing', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      // Abandon the text before typing anything.
      await createTextAt(p.page, 0, 0);
      await endEdit(p.page);

      // No text object was ever committed to the doc.
      expect((await objectCountByType(p.page)).text ?? 0).toBe(0);

      // A marquee over the spot selects nothing (there is no object there).
      const cam = await homeCam(p.page);
      const { x: x0, y: y0 } = toScreen(cam, -80, -80);
      const { x: x1, y: y1 } = toScreen(cam, 80, 80);
      await p.page.keyboard.down('Shift');
      await p.page.mouse.move(x0, y0);
      await p.page.mouse.down();
      await p.page.mouse.move(x1, y1, { steps: 5 });
      await p.page.mouse.up();
      await p.page.keyboard.up('Shift');
      expect(p.page.locator('[data-testid="selection-bar"]')).toHaveCount(0);
    } finally {
      await closeParticipant(p);
    }
  });
});
