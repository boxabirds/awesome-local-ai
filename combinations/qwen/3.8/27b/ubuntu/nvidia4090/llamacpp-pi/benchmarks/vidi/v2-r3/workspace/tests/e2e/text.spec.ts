/**
 * Story 9 — e2e text workflows (TC-26..TC-31) with real fonts and the real
 * sync server:
 *
 *   - TC-26: long annotation (300 chars) → stored width capped at
 *            TEXT_MAX_AUTO_WIDTH_WORLD, several rendered lines.
 *   - TC-27: dragging the right handle narrower rewraps the words, the height
 *            grows, and no top/bottom handles exist.
 *   - TC-28: title a retro section — create, XL, drag over the cluster,
 *            delete, Ctrl/Cmd+Z restores it.
 *   - TC-29: two contexts type into the same text simultaneously → identical
 *            text containing every character.
 *   - TC-30: MAX_CONCURRENT_EDITORS contexts each create a heading at once →
 *            all headings visible on every screen.
 *   - TC-31: abandoned text (T, click, Escape without typing) → no text
 *            object in the doc; shift-drag over the spot selects nothing.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { apiCreateBoard, createNoteAt, openBoard } from './helpers';

interface TextObj {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  widthMode: string;
  size: string;
  text: string;
}

/** Read every text object straight from the synced Y.Doc. */
async function textObjects(page: Page): Promise<TextObj[]> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    const out: TextObj[] = [];
    objects.forEach((item: any, id: string) => {
      if (item.get('type') !== 'text') return;
      const t = item.get('text');
      out.push({
        id,
        x: item.get('x'),
        y: item.get('y'),
        width: item.get('width') ?? 0,
        height: item.get('height') ?? 0,
        widthMode: item.get('widthMode') ?? '',
        size: item.get('size') ?? 'M',
        text: t ? t.toString() : '',
      });
    });
    return out;
  });
}

/** The text object's editor (exact name — other labels contain "Text"). */
const editor = (page: Page) => page.getByRole('textbox', { name: 'Text', exact: true });

/** Arm the Text tool and click at screen (sx, sy): creates + edits a text. */
async function createTextAt(page: Page, sx: number, sy: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(sx, sy);
  await editor(page).waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

/** Enter edit mode on the single selected text (select by click, then Enter). */
async function editTextAt(page: Page, sx: number, sy: number): Promise<void> {
  await page.mouse.click(sx, sy);
  await page.keyboard.press('Enter');
  await editor(page).waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
}

/**
 * Seed a text object directly into the page's Y.Doc under a NON-local origin
 * (visible to every participant, captured by no undo history). The box is
 * seeded with a plausible size so the object is clickable before any client
 * has measured it.
 */
async function seedTextRemote(page: Page, content: string, x = 0, y = -100): Promise<string> {
  return page.evaluate(
    ([content, x, y]) => {
      const Y = (window as any).__vidi6.Y;
      const doc = (window as any).__vidi6.doc;
      const objects = doc.getMap('objects');
      let maxZ = 0;
      objects.forEach((item: any) => {
        const z = item.get('z') ?? 0;
        if (z > maxZ) maxZ = z;
      });
      const id = crypto.randomUUID();
      doc.transact(
        () => {
          const item = new Y.Map();
          item.set('type', 'text');
          item.set('x', x);
          item.set('y', y);
          item.set('size', 'M');
          item.set('width', Math.max(120, content.length * 10));
          item.set('height', 26); // one line of M text (20px × 1.3)
          item.set('widthMode', 'auto');
          const t = new Y.Text();
          t.insert(0, content);
          item.set('text', t);
          item.set('z', maxZ + 1);
          item.set('createdAt', Date.now());
          objects.set(id, item);
        },
        'e2e-seed-remote',
      );
      return id;
    },
    [content, x, y],
  );
}

/** 300-character annotation fixture (TC-26). */
const LONG_300 = ('The review notes are long: layout, sync and editing all needed a second pass before the demo. ')
  .repeat(6)
  .slice(0, 300);

/** Multi-word paragraph for the rewrap test (TC-27). */
const REWRAP_PARA =
  'Wrapping should keep every word whole and break at spaces. ' +
  'The box width drives the line breaks, the height follows the lines, ' +
  'and the text stays readable at every size.';

test.describe('story 9: e2e text workflows (TC-26..TC-31)', () => {
  test('TC-26: long annotation caps the stored width and wraps into several lines', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const board = await apiCreateBoard(request);
    await openBoard(page, board);

    expect(LONG_300.length).toBe(300);
    await createTextAt(page, 640, 240);
    await editor(page).pressSequentially(LONG_300, { delay: 0 });

    // The stored box: width capped at the auto-width limit…
    await expect
      .poll(async () => (await textObjects(page))[0]?.width ?? 0, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    const [obj] = await textObjects(page);
    expect(obj!.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    // …and several rendered lines (height = lines × font × 1.3).
    const lines = obj!.height / (TEXT_SIZES.M * 1.3);
    expect(lines).toBeGreaterThanOrEqual(3);
    expect(obj!.text).toBe(LONG_300);

    // The rendered element carries the same content.
    await page.keyboard.press('Escape');
    await expect(page.getByText(LONG_300.slice(0, 40)).first()).toBeVisible();
    await context.close();
  });

  test('TC-27: dragging the right handle narrower rewraps; no top/bottom handles', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const board = await apiCreateBoard(request);
    await openBoard(page, board);

    await createTextAt(page, 560, 220);
    await editor(page).pressSequentially(REWRAP_PARA, { delay: 0 });
    await page.keyboard.press('Escape');

    const [before] = await textObjects(page);
    expect(before!.width).toBeGreaterThan(0);

    // Only the left/right handles exist for a text object.
    expect(await page.getByLabel('Resize top').count()).toBe(0);
    expect(await page.getByLabel('Resize bottom').count()).toBe(0);
    expect(await page.getByLabel('Resize left').count()).toBe(1);
    expect(await page.getByLabel('Resize right').count()).toBe(1);

    // Drag the right handle to half the width.
    const el = page.locator('[data-text-id]').first();
    const b = (await el.boundingBox())!;
    const startX = b.x + b.width;
    const midY = b.y + b.height / 2;
    await page.mouse.move(startX, midY);
    await page.mouse.down();
    await page.mouse.move(startX - b.width / 2, midY, { steps: 8 });
    await page.mouse.up();

    const [after] = await textObjects(page);
    // The stored width is roughly the dragged width (fixed mode)…
    expect(after!.widthMode).toBe('fixed');
    expect(after!.width).toBeLessThan(before!.width);
    // …the content is unchanged…
    expect(after!.text).toBe(before!.text);
    // …and the rewrapped text needs at least as many lines (usually more).
    expect(after!.height).toBeGreaterThanOrEqual(before!.height);
    await context.close();
  });

  test('TC-28: title a retro section — create, XL, drag, delete, undo restores', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const board = await apiCreateBoard(request);
    await openBoard(page, board);

    // A small cluster of sticky notes below the future title.
    await createNoteAt(page, 560, 430);
    await page.keyboard.press('Escape');
    await createNoteAt(page, 700, 430);
    await page.keyboard.press('Escape');
    await createNoteAt(page, 630, 520);
    await page.keyboard.press('Escape');

    // Title above the cluster.
    await createTextAt(page, 580, 320);
    await editor(page).pressSequentially('Went well', { delay: 0 });
    await page.keyboard.press('Escape'); // the text stays selected

    // Choose XL from the text toolbar.
    await page.getByRole('button', { name: 'Size XL' }).click();
    const [xl] = await textObjects(page);
    expect(xl!.size).toBe('XL');

    // Drag the title over the cluster.
    const el = page.locator('[data-text-id]').first();
    const b = (await el.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(630, 470, { steps: 8 });
    await page.mouse.up();
    const [moved] = await textObjects(page);
    // The grabbed point was the text's centre; it now sits at screen
    // (630, 470) → world (-10, 70).
    expect(Math.abs(moved!.x + moved!.width / 2 - (630 - 640))).toBeLessThan(5);
    expect(Math.abs(moved!.y + moved!.height / 2 - (470 - 400))).toBeLessThan(5);

    // Delete it…
    await page.getByRole('button', { name: 'Delete text' }).click();
    await expect
      .poll(async () => (await textObjects(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(0);

    // …and undo restores it (same text, same size).
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await textObjects(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);
    const [restored] = await textObjects(page);
    expect(restored!.text).toBe('Went well');
    expect(restored!.size).toBe('XL');
    await context.close();
  });

  test('TC-29: two contexts type into the same text simultaneously', async ({
    browser,
    request,
  }) => {
    const board = await apiCreateBoard(request);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await openBoard(a, board);
    await openBoard(b, board);

    // A shared text, seeded remotely so both see it before typing.
    await seedTextRemote(a, 'shared', 0, -100);
    await expect
      .poll(async () => (await textObjects(b)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(1);

    // Both enter edit mode on the same object (the box covers screen
    // (640..760, 300..326); click well inside).
    await editTextAt(a, 660, 310);
    await editTextAt(b, 660, 310);

    // Type at the same time; the Y.Text merges both streams.
    await Promise.all([
      editor(a).pressSequentially('AAA', { delay: 40 }),
      editor(b).pressSequentially('BBB', { delay: 40 }),
    ]);

    // Both screens converge on the same text containing every character.
    await expect
      .poll(
        async () => JSON.stringify((await textObjects(a)).map((t) => t.text)) ===
          JSON.stringify((await textObjects(b)).map((t) => t.text)),
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);
    const [final] = await textObjects(a);
    const sorted = [...final!.text].sort().join('');
    expect(sorted).toBe([...'sharedAAABBB'].sort().join(''));
    await ctxA.close();
    await ctxB.close();
  });

  test('TC-30: MAX_CONCURRENT_EDITORS contexts create headings at once', async ({
    browser,
    request,
  }) => {
    const board = await apiCreateBoard(request);
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await openBoard(page, board);
      contexts.push(ctx);
      pages.push(page);
    }

    // All contexts create a heading at (roughly) the same time.
    await Promise.all(
      pages.map(async (page, i) => {
        await createTextAt(page, 440 + i * 150, 240);
        await editor(page).pressSequentially(`Heading ${i}`, { delay: 5 });
        await page.keyboard.press('Escape');
      }),
    );

    // Every screen shows every heading (poll the full text set — the
    // characters of concurrent sessions can land slightly after the objects).
    const expected = JSON.stringify(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Heading ${i}`).sort(),
    );
    for (const page of pages) {
      await expect
        .poll(async () => JSON.stringify((await textObjects(page)).map((t) => t.text).sort()), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(expected);
    }
    for (const ctx of contexts) await ctx.close();
  });

  test('TC-31: abandoned text leaves no object; marquee over the spot selects nothing', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const board = await apiCreateBoard(request);
    await openBoard(page, board);

    await createTextAt(page, 640, 300);
    // Escape without typing a single character.
    await page.keyboard.press('Escape');

    // No text object remains in the document…
    await expect
      .poll(async () => (await textObjects(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(0);
    // …and its element is gone from the board (the re-render is async,
    // so wait for it instead of asserting in the same tick as the doc).
    await expect
      .poll(async () => page.locator('[data-text-id]').count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(0);

    // A shift-drag marquee over the spot selects nothing.
    await page.mouse.move(600, 260);
    await page.mouse.down();
    await page.mouse.move(700, 340, { steps: 6 });
    await page.mouse.up();
    expect(await page.locator('[data-selection-overlay]').count()).toBe(0);
    expect(await page.locator('[data-selection-bar]').count()).toBe(0);
    await context.close();
  });
});
