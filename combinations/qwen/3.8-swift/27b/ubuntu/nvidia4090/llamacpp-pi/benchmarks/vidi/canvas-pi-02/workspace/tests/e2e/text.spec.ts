// E2E tests for story 9 (text.object, text.tool_ui): TC-26 to TC-31.
// Runs against the `dev:test` server (Vite --mode test), which exposes the
// window.__vidi6 hooks. Single-page tests use setCamera(0,0,1) so screen
// and world coordinates are identical; multi-context tests share the
// app's default camera (origin at the viewport centre).

import { expect, test } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
} from '../../src/shared/config';
import { openBoard, setCamera } from './helpers/board';
import { connectParticipants, disposeAll, expectWithin, newBoard } from './helpers/participants';

/** A 300-character fixture with mixed word lengths (TC-26). */
const LONG_ANNOTATION = (
  'Retro annotation for the long annotation test: ' +
  'the layout must wrap at the maximum auto width, ' +
  'grow the box height line by line, and keep every word intact. ' +
  'Short, medium-length and quite-longer words all appear here. '
).slice(0, 300);

async function getTexts(page: import('@playwright/test').Page): Promise<
  Array<{
    id: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    text: string;
    size: string | null;
    widthMode: 'auto' | 'fixed' | null;
    z: number;
  }>
> {
  return page.evaluate(() => window.__vidi6?.getTextObjects() ?? []);
}

/** Select tool (V), then Text tool (T). */
async function textTool(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('t');
}

test('TC-26: long annotation — stored width is the max auto width, several rendered lines', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);

  await textTool(page);
  await page.mouse.click(200, 200);
  const input = page.getByTestId('text-editor-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(LONG_ANNOTATION);
  await page.keyboard.press('Escape');

  const texts = await getTexts(page);
  expect(texts).toHaveLength(1);
  const t = texts[0];
  expect(t.text).toBe(LONG_ANNOTATION);
  expect(t.size).toBe('M');
  expect(t.widthMode).toBe('auto');
  // The stored width is the max auto width (±2 units).
  expect(t.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, -1);
  expect(t.width!).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
  expect(t.width!).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
  // Several rendered lines: 300 chars at size M (26 world units per line,
  // 592 of capacity per line) span at least four lines for any font
  // (≥4 × 26 = 104) and at most ten (≤10 × 26 = 260).
  expect(t.height!).toBeGreaterThanOrEqual(4 * 26);
  expect(t.height!).toBeLessThanOrEqual(10 * 26);

  // The object renders (not just the doc): the displayed text is present.
  await expect(page.getByTestId('text-object-text')).toContainText('Retro annotation');
});

test('TC-27: narrowing the right handle rewraps words, height grows, no top/bottom handles', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);

  await textTool(page);
  await page.mouse.click(200, 200);
  await page.keyboard.type(LONG_ANNOTATION);
  await page.keyboard.press('Escape'); // the text stays selected

  // Only e/w handles for a single text (no top/bottom).
  const handleNames = async () => {
    const hs = await page.locator('.selection-handle').all();
    return Promise.all(hs.map((h) => h.getAttribute('aria-label')));
  };
  expect(await handleNames()).toEqual(['Resize right', 'Resize left']);

  const before = (await getTexts(page))[0];

  // Drag the right handle 300 px to the left: width 600 → 300 (fixed).
  const handle = page.getByRole('button', { name: 'Resize right' });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 300, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = (await getTexts(page))[0];
  expect(after.widthMode).toBe('fixed');
  expect(after.width).toBeCloseTo(before.width! - 300, 0);
  // Rewrap: more lines in the narrower box.
  expect(after.height).toBeGreaterThan(before.height!);
  // Still no top/bottom handles.
  expect(await handleNames()).toEqual(['Resize right', 'Resize left']);
});

test('TC-28: title a retro section — XL size, marquee over the cluster, Delete, undo restores', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);

  // A cluster of two notes around (400,400).
  await page.evaluate(() => {
    window.__vidi6?.createSticky(400, 400);
    window.__vidi6?.createSticky(450, 450);
  });

  // T, click above the cluster (empty space), type the title, Escape
  // (stays selected).
  await textTool(page);
  await page.mouse.click(400, 250);
  await page.keyboard.type('Went well');
  await page.keyboard.press('Escape');
  expect(await page.getByTestId('text-toolbar').count()).toBe(1);

  // XL from the text toolbar.
  await page.getByRole('button', { name: 'Size XL' }).click();
  const sized = (await getTexts(page))[0];
  expect(sized.size).toBe('XL');

  // Drag over the cluster (Shift+drag marquee) selects the title AND both
  // notes: a generous rect fully containing all three.
  await page.keyboard.press('v');
  await page.keyboard.down('Shift');
  await page.mouse.move(200, 220);
  await page.mouse.down();
  await page.mouse.move(800, 600, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const selectedIds = await page.evaluate(() => window.__vidi6?.getSelectedIds() ?? []);
  expect(selectedIds).toHaveLength(3);

  // Delete removes the whole selection…
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => (window.__vidi6?.getAllObjects() ?? []).length)).toBe(0);
  expect(await getTexts(page)).toHaveLength(0);

  // …and one undo restores it (title XL + both notes).
  await page.keyboard.press('Control+z');
  await expect
    .poll(async () => page.evaluate(() => (window.__vidi6?.getAllObjects?.() ?? []).length))
    .toBe(3);
  const restored = await getTexts(page);
  expect(restored).toHaveLength(1);
  expect(restored[0].text).toBe('Went well');
  expect(restored[0].size).toBe('XL');
});

test('TC-29: two contexts type into the same text simultaneously — identical text with every character', async ({
  browser,
}) => {
  const boardId = newBoard();
  const [alex, sam] = await connectParticipants(browser, boardId, 2);
  try {
    // Alex creates a text (both cameras centre the world origin at
    // (640,400)) and gives it a starting character.
    await alex.page.keyboard.press('t');
    await alex.page.mouse.click(700, 400);
    await expect(alex.page.getByTestId('text-editor-input')).toBeFocused();
    await alex.page.keyboard.type('X');
    await alex.page.keyboard.press('Escape');

    const texts = await alex.page.evaluate(() => window.__vidi6?.getTextObjects() ?? []);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('X');

    // Both open the editor on the same text object.
    const center = async (p: import('@playwright/test').Page) => {
      const box = (await p.locator('[data-testid="text-object"]').first().boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const aPos = await center(alex.page);
    const sPos = await center(sam.page);
    await Promise.all([
      alex.page.mouse.dblclick(aPos.x, aPos.y),
      sam.page.mouse.dblclick(sPos.x, sPos.y),
    ]);
    await expect(alex.page.getByTestId('text-editor-input')).toBeFocused();
    await expect(sam.page.getByTestId('text-editor-input')).toBeFocused();

    // Interleaved typing from both sides.
    await Promise.all([
      alex.page.keyboard.type('A1'),
      sam.page.keyboard.type('B2'),
    ]);
    await Promise.all([
      alex.page.keyboard.press('Escape'),
      sam.page.keyboard.press('Escape'),
    ]);

    const textOf = (p: import('@playwright/test').Page) =>
      p.evaluate(() => (window.__vidi6?.getTextObjects() ?? [])[0]?.text ?? '');
    await expectWithin(
      async () => {
        const ta = await textOf(alex.page);
        const ts = await textOf(sam.page);
        return ta === ts && ['X', 'A', '1', 'B', '2'].every((ch) => ta.includes(ch));
      },
      5000,
    ).toBe(true);
  } finally {
    await disposeAll([alex, sam]);
  }
});

test('TC-30: full-capacity session — every context creates a heading via the Text tool, all visible on every screen', async ({
  browser,
}) => {
  const boardId = newBoard();
  const parts = await connectParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);
  try {
    // Each context creates a heading at a distinct point, all at once.
    await Promise.all(
      parts.map(async (p, i) => {
        await p.page.keyboard.press('t');
        await p.page.mouse.click(640 + (i - 2) * 120, 400);
        await p.page.keyboard.type(`H${i}`);
        await p.page.keyboard.press('Escape');
      }),
    );

    // Every screen shows every heading.
    await Promise.all(
      parts.map(async (p) => {
        await expectWithin(
          async () => {
            const texts = await p.page.evaluate(() => window.__vidi6?.getTextObjects() ?? []);
            const rendered = await p.page.locator('[data-testid="text-object"]').count();
            const values = texts.map((t) => t.text).sort();
            const expected = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `H${i}`).sort();
            return values.join('|') === expected.join('|') && rendered === MAX_CONCURRENT_EDITORS;
          },
          5000,
        ).toBe(true);
      }),
    );
  } finally {
    await disposeAll(parts);
  }
});

test('TC-31: abandoned text — T, click, Escape without typing → no object; marquee selects nothing', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, 0, 0, 1);

  await textTool(page);
  await page.mouse.click(300, 200);
  await expect(page.getByTestId('text-editor-input')).toBeFocused();
  await page.keyboard.press('Escape'); // abandoned: zero characters

  // No text object in the doc.
  expect(await getTexts(page)).toHaveLength(0);
  expect(await page.evaluate(() => (window.__vidi6?.getAllObjects?.() ?? []).length)).toBe(0);

  // A marquee over the spot selects nothing.
  await page.keyboard.down('Shift');
  await page.mouse.move(280, 180);
  await page.mouse.down();
  await page.mouse.move(340, 240, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__vidi6?.getSelectedIds() ?? [])).toHaveLength(0);
});
