import { test, expect, type Page } from '@playwright/test';
import { getObjects, gotoBoard } from './helpers/board';
import {
  createNoteAt,
  createTextAt,
  editTextObject,
  finishTextEdit,
  longAnnotationWraps,
  newBoardId,
  objectCenterScreen,
  openBoard,
  closeAll,
  getText,
  getTextContent,
  MAX_CONCURRENT_EDITORS,
} from './participants';

/**
 * Story 9 e2e (chromium): the Text tool and text objects with real fonts and
 * the real sync server. TC-26 (wrapping) also runs in firefox/webkit via
 * text-wrapping.spec.ts.
 *
 * The viewport is 1280x800 with the initial camera centred on the origin at
 * zoom 1; screen-to-world conversions below use the live camera from
 * getCamera/objectCenterScreen rather than hardcoded values.
 */

test.describe('Text: long annotation and resize (text.object)', () => {
  test('TC-26: 300-character annotation caps at 600 and wraps to several lines', async ({ page }) => {
    await longAnnotationWraps(page);
  });

  test('TC-27: dragging the right handle narrower rewraps the words, height grows, no top/bottom handles', async ({
    page,
  }) => {
    await gotoBoard(page);
    const id = await createTextAt(page, 640, 360);
    await page.keyboard.insertText('The quick brown fox jumps over the lazy dog again and again and again and again.');
    await finishTextEdit(page);

    const before = (await getText(page, id))!;
    expect(before.widthMode).toBe('auto');
    expect(before.width).toBeGreaterThan(200);
    const beforeWidth = before.width as number;
    const beforeHeight = before.height as number;

    // Only the e and w handles exist for a single text (no n/s/ne/nw/se/sw).
    const handleNames = async (pg: Page) =>
      (await pg
        .locator('[data-handle]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-handle')))).sort();
    await expect(page.locator('[data-handle]')).toHaveCount(2);
    expect(await handleNames(page)).toEqual(['e', 'w']);

    // Drag the east handle exactly 200 screen px (world px at zoom 1) left.
    const box = await page.locator('[data-handle="e"]').boundingBox();
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 200, start.y, { steps: 10 });
    await page.mouse.up();

    const after = (await getText(page, id))!;
    // Fixed mode at the dragged width.
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(beforeWidth - 200, 0);
    // The same words rewrap into more lines: the box grows taller.
    expect(after.height).toBeGreaterThan(beforeHeight);
    // Still only the horizontal handles.
    expect(await handleNames(page)).toEqual(['e', 'w']);
  });
});

test.describe('Text: heading golden path (text.object)', () => {
  test('TC-28: XL heading, drag over the cluster, Delete, Ctrl+Z restores it', async ({ page }) => {
    await gotoBoard(page);

    // A cluster of two stickies around the origin.
    const a = await createNoteAt(page, 450, 350);
    const b = await createNoteAt(page, 650, 350);
    expect(a).not.toBe(b);

    // Title it: Text tool, click above the cluster, type, Escape.
    const id = await createTextAt(page, 550, 200);
    await page.keyboard.type('Went well');
    await finishTextEdit(page);

    // Size it up to XL (position must not move).
    const beforeSize = (await getText(page, id))!;
    await page.locator('[data-testid="text-size-XL"]').click();
    const sized = (await getText(page, id))!;
    expect(sized.size).toBe('XL');
    expect(sized.x).toBe(beforeSize.x);
    expect(sized.y).toBe(beforeSize.y);

    // Drag the heading over the cluster: it ends above both stickies.
    const center = await objectCenterScreen(page, sized);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(550, 350, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const o = (await getText(page, id))!;
        const notes = (await getObjects(page)).filter((n) => n.type === 'sticky');
        return o.z > Math.max(...notes.map((n) => n.z));
      }, { timeout: 5000 })
      .toBe(true);

    // Delete the heading (it is still selected after the drag).
    await page.keyboard.press('Delete');
    await expect
      .poll(async () => (await getObjects(page)).some((o) => o.id === id), { timeout: 5000 })
      .toBe(false);

    // One Ctrl/Cmd+Z restores it (text, size and position).
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);
    await expect
      .poll(async () => (await getText(page, id)) !== null, { timeout: 5000 })
      .toBe(true);
    const restored = (await getText(page, id))!;
    expect(restored.size).toBe('XL');
    expect(await getTextContent(page, id)).toBe('Went well');
  });
});

test.describe('Text: concurrent editing (text.object)', () => {
  test('TC-29: two contexts type into the same text at the same time', async ({ browser }) => {
    const boardId = newBoardId();
    const [p1, p2] = await Promise.all([openBoard(browser, boardId), openBoard(browser, boardId)]);
    try {
      // p1 creates the text and keeps editing it.
      const id = await createTextAt(p1.page, 400, 300);
      await p1.page.keyboard.type('Hello ');

      // p2 waits until it sees the synced content, then joins the same text.
      await expect
        .poll(async () => (await getTextContent(p2.page, id)), { timeout: 10_000 })
        .toBe('Hello ');
      await editTextObject(p2.page, id);
      await p2.page.keyboard.type('World');
      // p2's document has the local commit before anyone leaves editing.
      await expect
        .poll(async () => (await getTextContent(p2.page, id)), { timeout: 5000 })
        .toBe('Hello World');

      // Both leave editing.
      await p2.page.keyboard.press('Escape');
      await p1.page.keyboard.press('Escape');

      // Every screen converged to the same text containing every character.
      await expect
        .poll(async () => (await getTextContent(p1.page, id)), { timeout: 10_000 })
        .toBe('Hello World');
      await expect
        .poll(async () => (await getTextContent(p2.page, id)), { timeout: 10_000 })
        .toBe('Hello World');
    } finally {
      await closeAll(p1, p2);
    }
  });

  test('TC-30: five contexts each create a heading at once; all visible on every screen', async ({
    browser,
  }) => {
    const boardId = newBoardId();
    const ps = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => openBoard(browser, boardId)),
    );
    try {
      // All five create a heading "simultaneously" through the Text tool; each
      // context waits for its own heading to be committed before finishing.
      await Promise.all(
        ps.map(async (p, i) => {
          const sx = 200 + i * 160;
          const sy = 250 + (i % 2) * 100;
          const heading = `Heading ${i + 1}`;
          const id = await createTextAt(p.page, sx, sy);
          await p.page.keyboard.type(heading);
          await expect.poll(async () => (await getTextContent(p.page, id)), { timeout: 5000 }).toBe(heading);
          await finishTextEdit(p.page);
        }),
      );

      // Every screen shows all five headings.
      for (const p of ps) {
        await expect
          .poll(async () => (await getObjects(p.page)).filter((o) => o.type === 'text').length, {
            timeout: 10_000,
          })
          .toBe(MAX_CONCURRENT_EDITORS);
        await expect
          .poll(async () => {
            const contents = (await getObjects(p.page))
              .filter((o) => o.type === 'text')
              .map((t) => t.text ?? '')
              .sort();
            return contents.join('|');
          }, { timeout: 10_000 })
          .toBe('Heading 1|Heading 2|Heading 3|Heading 4|Heading 5');
        await expect(p.page.locator('[data-testid="text-object"]')).toHaveCount(MAX_CONCURRENT_EDITORS);
      }
    } finally {
      await closeAll(...ps);
    }
  });
});

test.describe('Text: abandoned text (text.object)', () => {
  test('TC-31: T, click, Escape without typing -> no object; marquee over the spot selects nothing', async ({
    page,
  }) => {
    await gotoBoard(page);

    // Start a text and abandon it immediately.
    await createTextAt(page, 400, 300); // editor open, no characters typed
    await finishTextEdit(page);

    // The object vanished: nothing of type text in the doc.
    expect((await getObjects(page)).filter((o) => o.type === 'text')).toEqual([]);
    expect(await page.locator('[data-testid="text-object"]').count()).toBe(0);

    // Shift+drag (marquee) over the spot selects nothing.
    await page.keyboard.down('Shift');
    await page.mouse.move(320, 220);
    await page.mouse.down();
    await page.mouse.move(480, 380, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    expect(await page.locator('[data-selected]').count()).toBe(0);
    expect((await getObjects(page)).filter((o) => o.type === 'text')).toEqual([]);
  });
});
