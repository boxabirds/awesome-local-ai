/**
 * Story 9 e2e: free text on the board (TC-26 to TC-31) — the Text tool,
 * long-annotation auto wrapping at the 600-unit cap, fixed-width rewrap,
 * the heading workflow (create → size → move → delete → undo), concurrent
 * editing, full-capacity simultaneous creation, and abandoned-text removal.
 */
import { test, expect, type Page } from '@playwright/test';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, TEXT_LINE_HEIGHT, MAX_CONCURRENT_EDITORS } from 'src/shared/config';
import { createBoardIdForPage } from './helpers/board';
import { openParticipants } from './helpers/participants';
import { createNote } from './helpers/participants';
import { LONG_ANNOTATION } from '../fixtures/texts';

interface TextInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  widthMode: string;
  text: string;
}

async function openBoard(page: Page) {
  const id = await createBoardIdForPage(page);
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
}

/** All text objects in the doc, in creation order. */
async function getTexts(page: Page): Promise<TextInfo[]> {
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    return [...objects.keys()]
      .map((key: string) => {
        const obj: any = objects.get(key);
        if (obj.get('type') !== 'text') return null;
        return {
          id: key,
          x: obj.get('x'),
          y: obj.get('y'),
          width: obj.get('width'),
          height: obj.get('height'),
          size: obj.get('size'),
          widthMode: obj.get('widthMode'),
          text: obj.get('text')?.toString() ?? '',
        };
      })
      .filter(Boolean) as TextInfo[];
  });
}

/** The Text tool workflow: T, click at a screen point, type, Escape. */
async function createTextAt(page: Page, x: number, y: number, text: string): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  const editor = page.getByTestId('text-editor');
  await editor.waitFor({ timeout: 5000 });
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Double-click the text with `id` (at its rendered centre) and type. */
async function typeInText(page: Page, id: string, text: string): Promise<void> {
  const el = page.locator(`[data-note-id="${id}"]`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`text ${id} not found`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('text-textarea').waitFor({ timeout: 5000 });
  await page.keyboard.type(text, { delay: 60 });
  await page.keyboard.press('Escape');
}

test.describe('Workflow: Free text on the board', () => {
  test('TC-26: T + click creates text at the point; a 300-char annotation wraps at the 600-unit cap with several lines', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;
    const cx = width / 2;
    const cy = height / 2;

    await createTextAt(page, 400, 300, LONG_ANNOTATION);

    const [t] = await getTexts(page);
    expect(t).toBeTruthy();
    // Click at screen (400,300) with the origin-centred camera: world point.
    expect(t.x).toBe(400 - cx);
    expect(t.y).toBe(300 - cy);
    // The stored width is exactly the auto cap (±2 for font rounding).
    expect(t.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(t.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(t.widthMode).toBe('auto');
    expect(t.text).toBe(LONG_ANNOTATION);
    // Several rendered lines: the box is much taller than two M lines.
    const el = page.locator(`[data-note-id="${t.id}"]`);
    const box = await el.boundingBox();
    expect(box!.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT * 2);
  });

  test('TC-27: dragging the east handle narrower rewraps the words, grows the height, and the box keeps only east/west handles', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;
    const cx = width / 2;
    const cy = height / 2;

    await createTextAt(page, 400, 300, LONG_ANNOTATION);
    const [before] = await getTexts(page);
    expect(before.width).toBeCloseTo(TEXT_MAX_AUTO_WIDTH_WORLD, 0);

    // Select the text, then drag its east handle 200 world units in.
    const el = page.locator(`[data-note-id="${before.id}"]`);
    const box = await el.boundingBox()!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Only east/west handles exist for a text object.
    const handles = page.getByTestId('resize-handle');
    await expect(handles).toHaveCount(2);
    const east = page.locator('[data-handle="e"]');
    const hb = await east.boundingBox()!;
    const startX = hb.x + hb.width / 2;
    await page.mouse.move(startX, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(startX - 200, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();

    const [after] = await getTexts(page);
    // Fixed at 600 − 200 (±2), the height grew (more, shorter lines).
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 200 - 2);
    expect(after.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 200 + 2);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  test('TC-28: title a retro section — T, click, "Went well", XL, drag over the cluster, delete, Ctrl+Z restores', async ({ page }) => {
    await openBoard(page);
    // A small cluster of notes.
    await createNote(page, 620, 400, 'a');
    await createNote(page, 760, 430, 'b');

    // Create the heading above the cluster.
    await createTextAt(page, 560, 300, 'Went well');
    const [t] = await getTexts(page);
    expect(t.text).toBe('Went well');

    // Size it up with the text toolbar.
    await page.getByTestId('text-size-button-XL').click();
    let [sized] = await getTexts(page);
    expect(sized.size).toBe('XL');
    expect(sized.height).toBeGreaterThan(t.height);

    // Drag the heading over the cluster.
    const el = page.locator(`[data-note-id="${t.id}"]`);
    const box = await el.boundingBox()!;
    const fromX = box.x + box.width / 2;
    const fromY = box.y + box.height / 2;
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX + 80, fromY + 70, { steps: 8 });
    await page.mouse.up();
    let [moved] = await getTexts(page);
    expect(moved.x).toBeGreaterThan(t.x);
    expect(moved.y).toBeGreaterThan(t.y);

    // Delete it, then undo: it is restored with its text.
    await page.getByTestId('text-delete-button').click();
    await expect.poll(async () => (await getTexts(page)).length).toBe(0);
    await page.keyboard.press('Control+z');
    const restored = await getTexts(page);
    expect(restored).toHaveLength(1);
    expect(restored[0].text).toBe('Went well');
    expect(restored[0].size).toBe('XL');
  });

  test('TC-29: two contexts type into the same text simultaneously → identical text containing every character', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);

    // Alex creates the text; both sides must see the COMPLETE text before
    // typing (a stale textarea would insert before characters that arrive
    // later — correct Yjs, wrong test).
    await createTextAt(alex.page, 640, 360, 'Start');
    const [created] = await getTexts(alex.page);
    await expect.poll(async () => (await getTexts(sam.page))[0]?.text).toBe('Start');

    await Promise.all([
      typeInText(alex.page, created.id, 'AB'),
      typeInText(sam.page, created.id, 'CD'),
    ]);

    // Identical on both sides, every character present exactly once (poll:
    // the last remote keystroke may still be in flight).
    const sortedAll = 'StartABCD'.split('').sort().join('');
    await expect.poll(async () => {
      const a = (await getTexts(alex.page))[0]?.text ?? '';
      const s = (await getTexts(sam.page))[0]?.text ?? '';
      return a === s && a.length === 9 && a.split('').sort().join('') === sortedAll;
    }).toBe(true);

    alex.context.close();
    sam.context.close();
  });

  test('TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading via the Text tool at once → all visible on every screen', async ({ browser }) => {
    const parts = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const offsets: { x: number; y: number }[] = [
      { x: -300, y: -120 },
      { x: 0, y: -160 },
      { x: 300, y: -120 },
      { x: -150, y: 160 },
      { x: 150, y: 160 },
    ];

    await Promise.all(
      parts.map(async (p, i) => {
        const { width, height } = p.page.viewportSize()!;
        await createTextAt(p.page, width / 2 + offsets[i].x, height / 2 + offsets[i].y, `H${i}`);
      }),
    );

    const expected = offsets.map((_, i) => `H${i}`).sort().join(',');
    for (const p of parts) {
      // Remote creations (object + text) propagate over the wire; poll until
      // every heading with its full text is on this screen.
      await expect.poll(
        async () => (await getTexts(p.page)).map((t) => t.text).sort().join(','),
      ).toBe(expected);
      // All headings are rendered (visible elements) on this screen.
      await expect(p.page.getByTestId('text-object')).toHaveCount(MAX_CONCURRENT_EDITORS);
    }

    for (const p of parts) p.context.close();
  });

  test('TC-31: abandoned text — T, click, Escape without typing leaves no object; Shift+drag over the spot selects nothing', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    const editor = page.getByTestId('text-editor');
    await editor.waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');

    // No text object in the doc (text.empty_removed).
    expect(await getTexts(page)).toHaveLength(0);

    // The tool is back to Select; a Shift+drag marquee over the spot
    // selects nothing (sel.marquee_empty).
    expect(page.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.down('Shift');
    await page.mouse.move(350, 250);
    await page.mouse.down();
    await page.mouse.move(450, 350, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('selection-overlay')).toHaveCount(0);
  });
});
