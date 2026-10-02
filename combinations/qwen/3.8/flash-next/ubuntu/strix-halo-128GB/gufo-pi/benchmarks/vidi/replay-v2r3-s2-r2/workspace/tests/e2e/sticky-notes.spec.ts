import { test, expect, type Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { STICKY_SIZE_WORLD, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../src/shared/config';
import { PROSE_1000 } from '../fixtures/texts';

async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('[data-grid-layer="true"]');
  // Let the SPA finish mounting and attach pointer/dblclick handlers.
  await page.waitForTimeout(150);
}

async function noteIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-sticky-note]', (els) =>
    els.map((el) => (el as HTMLElement).dataset.noteId as string),
  );
}

async function createNoteByDblClick(page: Page, x: number, y: number): Promise<string> {
  const before = await noteIds(page);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(30);
  const after = await noteIds(page);
  const created = after.find((id) => !before.includes(id));
  if (!created) throw new Error('double-click did not create a note');
  return created;
}

function noteLocator(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

async function noteWorld(page: Page, id: string): Promise<{ x: number; y: number }> {
  return noteLocator(page, id).evaluate((el) => ({
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  }));
}

async function noteBox(page: Page, id: string) {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error('note boundingBox missing');
  return box;
}

async function topNoteIdAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      const note = el ? el.closest('[data-sticky-note]') : null;
      return note ? (note as HTMLElement).dataset.noteId ?? null : null;
    },
    [x, y],
  );
}

test.describe('sticky note workflows', () => {
  test('TC-30: double-click empty space creates a centred editable note', async ({ page }) => {
    await gotoBoard(page);
    const id = await createNoteByDblClick(page, 400, 300);
    await page.keyboard.type('Hello');

    const box = await noteBox(page, id);
    expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 300)).toBeLessThanOrEqual(1);

    await expect(page.getByTestId('sticky-textarea')).toHaveValue('Hello');
  });

  test('TC-31: dragging at 50% zoom keeps the grabbed point under the pointer', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    await page.waitForTimeout(50);
    const id = await createNoteByDblClick(page, 400, 300);
    await page.keyboard.press('Escape'); // end editing, keep selected

    const before = await noteWorld(page, id);
    const box = await noteBox(page, id);
    const grabX = box.x + box.width / 2;
    const grabY = box.y + box.height / 2;

    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(50);

    const after = await noteWorld(page, id);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(3);

    // The note followed the pointer on screen by exactly (100, 50) — the grabbed
    // point stayed under the pointer.
    const box2 = await noteBox(page, id);
    expect(Math.abs(box2.x - box.x - 100)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(box2.y - box.y - 50)).toBeLessThanOrEqual(1.5);
  });

  test('TC-32: dragging at 200% zoom moves world by +50/+25 and brings the note to front', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    await page.waitForTimeout(50);

    const idA = await createNoteByDblClick(page, 400, 300);
    await page.keyboard.press('Escape');
    // Create B by double-clicking just past A's right edge so it lands on empty
    // space, yet B (400px at zoom 2) still overlaps A.
    const idB = await createNoteByDblClick(page, 620, 300);
    await page.keyboard.press('Escape');

    const beforeA = await noteWorld(page, idA);
    // Before dragging, the later-created B is drawn on top where they overlap.
    expect(await topNoteIdAt(page, 450, 300)).toBe(idB);

    // Grab A in its top-left corner (outside B) and drag by (100, 50).
    const boxA = await noteBox(page, idA);
    const grabX = boxA.x + 20;
    const grabY = boxA.y + 20;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(50);

    const afterA = await noteWorld(page, idA);
    expect(Math.abs(afterA.x - beforeA.x - 50)).toBeLessThanOrEqual(3);
    expect(Math.abs(afterA.y - beforeA.y - 25)).toBeLessThanOrEqual(3);

    // The dragged note is now drawn above the note it overlaps.
    const overlapX = 550;
    const overlapY = 300;
    expect(await topNoteIdAt(page, overlapX, overlapY)).toBe(idA);
  });

  test('TC-33: text auto-fits, then clips with a fade at the minimum size', async ({ page }) => {
    await gotoBoard(page);
    const id = await createNoteByDblClick(page, 400, 300);
    await page.keyboard.type('Onboarding');

    const ta = page.getByTestId('sticky-textarea');
    const fontShort = await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontShort).toBe(STICKY_FONT_MAX_PX);

    await ta.fill(PROSE_1000);
    await page.waitForTimeout(60);

    const fontLong = await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontLong).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontLong).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);

    await expect(page.getByTestId('note-overflow-fade')).toBeVisible();

    // Nothing is drawn outside the note box: it stays its fixed size.
    const box = await noteBox(page, id);
    expect(Math.round(box.width)).toBe(STICKY_SIZE_WORLD);
    expect(Math.round(box.height)).toBe(STICKY_SIZE_WORLD);
  });

  test('TC-34: creating from the toolbar while panned far away centres the note on screen', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, { x: 100000, y: 100000, zoom: 1 });
    await page.waitForTimeout(50);

    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.waitForTimeout(50);

    const ids = await noteIds(page);
    expect(ids).toHaveLength(1);
    const box = await noteBox(page, ids[0]);
    // Viewport is 1280x800, so the centre is (640, 400).
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(2);
  });

  test('Workflow: brainstorm golden path — create, recolour, delete', async ({ page }) => {
    await gotoBoard(page);
    const keep = await createNoteByDblClick(page, 400, 300);
    await page.keyboard.type('Keep me');
    await page.keyboard.press('Escape');

    const doomed = await createNoteByDblClick(page, 700, 500);
    await page.keyboard.type('Delete me');
    await page.keyboard.press('Escape');

    // Select the keep note and recolour it green.
    const keepBox = await noteBox(page, keep);
    await page.mouse.click(keepBox.x + keepBox.width / 2, keepBox.y + keepBox.height / 2);
    await page.getByLabel('Green colour').click();
    const green = await noteLocator(page, keep).evaluate((el) =>
      getComputedStyle(el).backgroundColor,
    );
    expect(green).toBe('rgb(197, 225, 165)'); // #C5E1A5

    // Delete the doomed note via the bin button.
    const doomedBox = await noteBox(page, doomed);
    await page.mouse.click(doomedBox.x + doomedBox.width / 2, doomedBox.y + doomedBox.height / 2);
    await page.getByLabel('Delete note').click();

    const ids = await noteIds(page);
    expect(ids).toEqual([keep]);
    await expect(page.getByTestId('sticky-textarea')).toHaveCount(0);
  });
});
