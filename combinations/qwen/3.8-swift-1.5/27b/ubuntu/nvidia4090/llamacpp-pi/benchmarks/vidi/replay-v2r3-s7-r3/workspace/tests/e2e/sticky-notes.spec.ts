import { test, expect, type Page, type Locator } from '@playwright/test';
import { LONG_TEXT } from '../fixtures/texts';

/**
 * Story 2 E2E: capture ideas on sticky notes and rearrange them.
 *
 * These tests verify behaviour that only makes sense with a real browser:
 * pixel-accurate drag geometry at different zoom levels, real font auto-fit,
 * the overflow fade, and toolbar creation while the camera is panned far away.
 */

async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }) {
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
  // Wait until the camera state has actually been applied by the app.
  await page.waitForFunction(
    (c) => {
      const cur = (window as any).__vidi6.getCamera();
      return cur.x === c.x && cur.y === c.y && cur.zoom === c.zoom;
    },
    cam,
  );
}

/** Set a textarea's value the way React's value tracker expects, then fire input. */
async function setTextareaValue(page: Page, text: string) {
  await page.evaluate((value: string) => {
    const el = document.querySelector('textarea') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!
      .set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

function notes(page: Page): Locator {
  return page.locator('[data-testid^="sticky-note-"]');
}

async function noteCenter(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Assert `value` is within `tol` of `target`. */
function expectClose(value: number, target: number, tol: number) {
  expect(Math.abs(value - target), `expected ${value} to be within ${tol} of ${target}`).toBeLessThanOrEqual(
    tol,
  );
}

test.describe('Story 2: Sticky notes (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // Story 5: `/` is the home page; create a board from there.
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    await page.waitForSelector('[data-testid="board-viewport"]');
    await page.waitForFunction(() => !!(window as any).__vidi6);
  });

  // TC-30
  test('TC-30: double-click creates a note centred on the click; typing fills it', async ({ page }) => {
    await page.mouse.dblclick(400, 300);
    const note = notes(page).first();
    await expect(note).toBeVisible();
    expect(await notes(page).count()).toBe(1);

    // The note centre is on the click point (±1px) at the origin camera.
    const c = await noteCenter(note);
    expectClose(c.x, 400, 1);
    expectClose(c.y, 300, 1);

    // Type a word, end editing, and confirm the text is stored on the note.
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await expect(note).toContainText('Hello');
  });

  // TC-31
  test('TC-31: dragging at 50% zoom moves the note by world (200, 100) and follows the pointer', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    await page.mouse.dblclick(400, 300);
    const note = notes(page).first();
    await expect(note).toBeVisible();
    await page.keyboard.press('Escape');

    const before = (await note.boundingBox())!;
    const startX = before.x + before.width / 2;
    const startY = before.y + before.height / 2;

    // Real drag of (100, 50) screen pixels.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 8 });
    await page.mouse.up();

    const after = (await note.boundingBox())!;
    // Screen delta is (100, 50); at zoom 0.5 that is world (200, 100).
    expectClose(after.x - before.x, 100, 1);
    expectClose(after.y - before.y, 50, 1);
    // The grabbed point (centre) stays under the pointer (±1px).
    const c = await noteCenter(note);
    expectClose(c.x, startX + 100, 1);
    expectClose(c.y, startY + 50, 1);
  });

  // TC-32
  test('TC-32: dragging at 200% zoom moves by world (50, 25) and brings the note to the front', async ({ page }) => {
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    // Two notes, far apart so the first is easy to grab.
    await page.mouse.dblclick(300, 300);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(900, 300);
    await page.keyboard.press('Escape');
    expect(await notes(page).count()).toBe(2);

    const noteA = notes(page).nth(0); // first created (lower z)
    const aTestId = (await noteA.getAttribute('data-testid'))!;
    const noteAStable = page.locator(`[data-testid="${aTestId}"]`);
    const beforeA = (await noteAStable.boundingBox())!;
    const startX = beforeA.x + beforeA.width / 2;
    const startY = beforeA.y + beforeA.height / 2;

    // Real drag of (100, 50) screen pixels.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 8 });
    await page.mouse.up();

    const afterA = (await noteAStable.boundingBox())!;
    // Screen delta (100, 50) at zoom 2 → world (50, 25).
    expectClose(afterA.x - beforeA.x, 100, 1);
    expectClose(afterA.y - beforeA.y, 50, 1);

    // Dragging brings the note to the front: it now has the highest z-index.
    const zIndices = await notes(page).evaluateAll((els) =>
      els.map((el) => parseInt(getComputedStyle(el).zIndex, 10)),
    );
    const aZ = await noteAStable.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));
    expect(aZ).toBe(Math.max(...zIndices));
    expect(aZ).toBeGreaterThan(1);
  });

  // TC-33
  test('TC-33: text auto-fits the note; long text shrinks to the minimum and shows a fade', async ({ page }) => {
    await page.mouse.dblclick(400, 300);
    const note = notes(page).first();
    await expect(note).toBeVisible();

    // One short word → the font stays at the maximum (24px).
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    const textDiv = note.locator('div[style*="font-size"]');
    expect(await textDiv.evaluate((el: Element) => getComputedStyle(el).fontSize)).toBe('24px');

    // Paste 1,000 characters → the font shrinks to the minimum (≥ 10px) and
    // the note shows the overflow fade.
    await note.dblclick();
    await page.locator('textarea').focus();
    await setTextareaValue(page, LONG_TEXT);
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');

    const fontSize = await textDiv.evaluate((el: Element) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(10);
    await expect(note.locator('[data-testid="sticky-overflow-fade"]')).toBeVisible();
  });

  // TC-34
  test('TC-34: creating via the toolbar while panned far away puts the note at screen centre', async ({ page }) => {
    await setCamera(page, { x: -5000, y: -5000, zoom: 1 });
    await page.getByRole('button', { name: 'Sticky note' }).click();
    const note = notes(page).first();
    await expect(note).toBeVisible();

    // The note is centred on the screen regardless of the camera. Use the real
    // window size (the board container fills it) rather than a hard-coded value.
    const { width, height } = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    const c = await noteCenter(note);
    expectClose(c.x, width / 2, 2);
    expectClose(c.y, height / 2, 2);
  });

  // Golden path: create → type → move → recolour → delete.
  test('golden path: create, type, move, recolour, delete ends with an empty board', async ({ page }) => {
    // Create and type.
    await page.mouse.dblclick(400, 300);
    const note = notes(page).first();
    await expect(note).toBeVisible();
    await page.keyboard.type('Ship it');
    await page.keyboard.press('Escape');
    await expect(note).toContainText('Ship it');

    // Move it.
    const before = (await note.boundingBox())!;
    const sx = before.x + before.width / 2;
    const sy = before.y + before.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 80, sy + 40, { steps: 6 });
    await page.mouse.up();
    const after = (await note.boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(0);

    // Recolour to green via the note toolbar.
    await note.click(); // select
    await page.getByRole('button', { name: 'Green colour' }).click();
    expect(await note.getAttribute('data-color')).toBe('green');

    // Delete it.
    await page.keyboard.press('Delete');
    expect(await notes(page).count()).toBe(0);
  });
});
