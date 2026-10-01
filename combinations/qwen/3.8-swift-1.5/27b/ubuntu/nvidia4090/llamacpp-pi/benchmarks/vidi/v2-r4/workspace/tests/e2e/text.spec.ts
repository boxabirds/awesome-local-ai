import { test, expect, type Page } from '@playwright/test';
import { setCamera } from './helpers/board';

/** Reads a snapshot of the Y.Doc object at `index` (test hook). */
async function getObjState(page: Page, index = 0): Promise<Record<string, unknown> | null> {
  return page.evaluate((idx) => {
    const doc = (window as any).__vidi6?.doc;
    if (!doc) return null;
    const objects = doc.getMap('objects');
    const entries = [...objects.entries()];
    const entry = entries[idx];
    if (!entry) return null;
    const [id, m] = entry as [string, any];
    const out: Record<string, unknown> = { id };
    m.forEach((v: any, k: string) => {
      out[k] = typeof v?.toString === 'function' && typeof v !== 'number' ? v.toString() : v;
    });
    return out;
  }, index);
}

async function getObjCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = (window as any).__vidi6?.doc;
    return doc ? doc.getMap('objects').size : 0;
  });
}

/** Activates the text tool and clicks the board at (x, y). Returns the editor. */
async function createTextAt(page: Page, x: number, y: number) {
  await page.keyboard.press('t');
  await page.click('[data-testid="board-viewport"]', { position: { x, y } });
  const editor = page.locator('[data-testid="text-editor"]');
  await expect(editor).toBeVisible();
  return editor;
}

/** Creates a sticky note at the view centre and exits edit mode. */
async function createSticky(page: Page): Promise<void> {
  await page.keyboard.press('n');
  await expect(page.locator('[data-testid="sticky-text-editor"]')).toBeVisible();
  await page.keyboard.press('Escape');
}

/** Shift+drag marquee from (x1,y1) to (x2,y2) over empty space. */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Drags a selection-overlay handle by (dx, dy) screen px. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const el = page.locator(`[data-testid="handle-${handle}"]`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`handle ${handle} not found`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('Story 9: Free text on the board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /new board/i }).click();
    await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15000 });
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
  });

  test('TC-01: T activates the text tool; click creates text at the point in edit mode; tool reverts', async ({ page }) => {
    await page.keyboard.press('t');
    await expect(page.locator('[aria-label="Text (T)"]')).toHaveAttribute('aria-pressed', 'true');

    await page.click('[data-testid="board-viewport"]', { position: { x: 400, y: 300 } });

    await expect(page.locator('[data-object-type="text"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
    // Tool reverted to Select
    await expect(page.locator('[aria-label="Text (T)"]')).toHaveAttribute('aria-pressed', 'false');

    // Created at the world point (screen - camera)
    const st = await getObjState(page);
    expect(st).not.toBeNull();
    expect(st!.type).toBe('text');
    expect(st!.x).toBe(-240);
    expect(st!.y).toBe(-100);
  });

  test('TC-02: Enter inserts a newline (multi-line text)', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('line one');
    await editor.press('Enter');
    await editor.pressSequentially('line two');
    const st = await getObjState(page);
    expect(st!.text).toBe('line one\nline two');
  });

  test('TC-03: Escape with content ends editing, keeps the object and its selection', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('keep me');
    await editor.press('Escape');

    await expect(page.locator('[data-testid="text-editor"]')).not.toBeVisible();
    await expect(page.locator('[data-object-type="text"]')).toHaveCount(1);
    // Still selected → the text toolbar is visible
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();
  });

  test('TC-04: Escape with empty text deletes the object', async ({ page }) => {
    await createTextAt(page, 400, 300);
    await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.locator('[data-object-type="text"]')).toHaveCount(0);
    expect(await getObjCount(page)).toBe(0);
  });

  test('TC-05: typing updates the stored box live (width grows)', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    const before = (await getObjState(page))!.width as number;
    await editor.pressSequentially('a much longer piece of text than before');
    const after = (await getObjState(page))!.width as number;
    expect(after).toBeGreaterThan(before);
  });

  test('TC-06: a very long single word is split and the box is capped at 600', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('a'.repeat(120));
    const st = await getObjState(page);
    expect(st!.width as number).toBeLessThanOrEqual(600);
    expect(st!.height as number).toBeGreaterThan(26);
  });

  test('TC-07: box width equals the canvas-measured width plus padding', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('Hello');
    const st = await getObjState(page);
    const measured = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '400 20px system-ui, sans-serif';
      return ctx.measureText('Hello').width;
    });
    expect(st!.width as number).toBeCloseTo(measured + 4, 0);
  });

  test('TC-08: words wrap at the max width (height grows, width capped)', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially(
      'the quick brown fox jumps over the lazy dog again and again with plenty of words',
    );
    const st = await getObjState(page);
    expect(st!.width as number).toBeLessThanOrEqual(600);
    expect(st!.height as number).toBeGreaterThan(26);
  });

  test('TC-09: a long unbroken word caps at 600 and splits by characters', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('supercalifragilisticexpialidociousantidisestablishmentarianism');
    const st = await getObjState(page);
    expect(st!.width as number).toBeLessThanOrEqual(600);
    expect(st!.height as number).toBeGreaterThan(26);
  });

  test('TC-10: dragging the e handle sets a fixed width; later typing re-wraps at that width', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('short');
    await editor.press('Escape');
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();

    // Widen with the east handle
    await dragHandle(page, 'e', 100, 0);
    let st = await getObjState(page);
    expect(st!.widthMode).toBe('fixed');
    const fixedWidth = st!.width as number;

    // Type more: the width stays fixed, the height grows (re-wrap)
    await page.locator('[data-object-type="text"]').dblclick();
    const editor2 = page.locator('[data-testid="text-editor"]');
    await expect(editor2).toBeVisible();
    await editor2.pressSequentially(' and a lot more text to force wrapping to happen');
    st = await getObjState(page);
    expect(st!.width).toBeCloseTo(fixedWidth, 0);
    expect(st!.height as number).toBeGreaterThan(26);
  });

  test('TC-11: size buttons S M L XL change the font size and the box', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('Hello World');
    await editor.press('Escape');
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();

    const hBefore = (await getObjState(page))!.height as number;
    await page.locator('[aria-label="Size L"]').click();
    let st = await getObjState(page);
    expect(st!.size).toBe('L');
    expect(st!.height as number).toBeGreaterThan(hBefore);

    await page.locator('[aria-label="Size S"]').click();
    st = await getObjState(page);
    expect(st!.size).toBe('S');
    expect(st!.height as number).toBeLessThan(hBefore);
  });

  test('TC-26: text + sticky selection shows all eight handles', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('text');
    await editor.press('Escape');
    // The first Escape ended editing; switch back to the select tool
    await page.keyboard.press('v');
    await createSticky(page);

    // Marquee fully containing both objects (marquee selection requires
    // full containment; text top-left at screen 400,300, sticky centred
    // near 640,400)
    await marquee(page, 350, 250, 800, 530);
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('2 selected');

    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      await expect(page.locator(`[data-testid="handle-${h}"]`)).toBeVisible();
    }
  });

  test('TC-27: group resize repositions the text; font size never changes', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('text');
    await editor.press('Escape');
    await page.keyboard.press('v');
    await createSticky(page);

    await marquee(page, 350, 250, 800, 530);
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('2 selected');

    // The text sits at the group's top-left; the sticky is to the right/below.
    // An SE drag grows the box from the top-left anchor, so the sticky moves
    // and grows while the text keeps its position. Font size never changes
    // via handles.
    const before = await page.evaluate(() => {
      const doc = (window as any).__vidi6?.doc;
      const out: any[] = [];
      doc.getMap('objects').forEach((m: any, id: string) => {
        out.push({ id, type: m.get('type'), x: m.get('x'), y: m.get('y'), size: m.get('size') });
      });
      return out;
    });
    const textBefore = before.find((o) => o.type === 'text')!;
    const stickyBefore = before.find((o) => o.type === 'sticky')!;

    await dragHandle(page, 'se', 150, 80);

    const after = await page.evaluate(() => {
      const doc = (window as any).__vidi6?.doc;
      const out: any[] = [];
      doc.getMap('objects').forEach((m: any, id: string) => {
        out.push({ id, type: m.get('type'), x: m.get('x'), y: m.get('y'), size: m.get('size') });
      });
      return out;
    });
    const textAfter = after.find((o) => o.id === textBefore.id)!;
    const stickyAfter = after.find((o) => o.id === stickyBefore.id)!;
    expect(textAfter.size).toBe('M'); // font size unchanged
    // The sticky moved with the group
    expect(stickyAfter.x).not.toBe(stickyBefore.x);
  });

  test('TC-28: a single text selection shows only the e and w handles', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('text');
    await editor.press('Escape');

    await expect(page.locator('[data-testid="handle-e"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-w"]')).toBeVisible();
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) {
      await expect(page.locator(`[data-testid="handle-${h}"]`)).not.toBeVisible();
    }
  });

  test('TC-29: dragging the e handle sets widthMode to fixed', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('hello');
    await editor.press('Escape');

    await dragHandle(page, 'e', 80, 0);
    const st = await getObjState(page);
    expect(st!.widthMode).toBe('fixed');
    expect(st!.width as number).toBeGreaterThan(60);
  });

  test('TC-30: empty text deleted on Escape; one undo restores it', async ({ page }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.press('Escape');
    expect(await getObjCount(page)).toBe(0);

    await page.keyboard.press('Control+z');
    expect(await getObjCount(page)).toBe(1);
  });

  test('TC-31: no empty text objects remain in the doc after abandoning edits', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await createTextAt(page, 300 + i * 60, 300);
      await page.keyboard.press('Escape');
    }
    expect(await getObjCount(page)).toBe(0);
  });

  test('TC-32: typing then Ctrl+Z reverts the text in one step', async ({ page }) => {
    const editor = await createTextAt(page, 400, 300);
    await editor.pressSequentially('hello');
    const midWidth = (await getObjState(page))!.width as number;
    expect(midWidth).toBeGreaterThan(40);

    await editor.press('Control+z');
    const st = await getObjState(page);
    expect(st!.text).toBe('');
    // The stored box reverted with the text (one step)
    expect(st!.width as number).toBeCloseTo(40, 0);
  });
});
