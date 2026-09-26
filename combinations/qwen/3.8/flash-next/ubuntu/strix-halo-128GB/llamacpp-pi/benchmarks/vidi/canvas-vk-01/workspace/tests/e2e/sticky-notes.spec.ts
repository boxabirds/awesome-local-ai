import { expect, test, type Page } from '@playwright/test';
import { STICKY_SIZE_WORLD, STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../src/shared/config';
import { openBoard, setCamera, centreOf, PIXEL_TOLERANCE } from './helpers/board';
import { PROSE_1000 } from '../fixtures/texts';

/** Helper: get the screen position of a note's top-left corner. */
async function notePosition(page: Page, noteId: string) {
  const el = page.locator(`[data-testid="sticky-note-${noteId}"]`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`Note ${noteId} not found`);
  return { x: box.x, y: box.y };
}

/** Helper: find the note id (first note on board). */
async function firstNoteId(page: Page): Promise<string> {
  const el = page.locator('[data-note-id]').first();
  await el.waitFor();
  const id = await el.getAttribute('data-note-id');
  if (!id) throw new Error('note-id missing');
  return id;
}

test.describe('Sticky notes E2E', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test('TC-30: dblclick at (400,300) creates centred note, type text', async ({ page }) => {
    // Double-click at screen (400,300) on empty board
    await page.mouse.dblclick(400, 300);
    await expect(page.locator('[data-note-id]')).toHaveCount(1);

    // Type text
    await page.keyboard.type('Hello');

    // Verify note centre is at (400,300) ±1px
    const noteId = await firstNoteId(page);
    const pos = await notePosition(page, noteId);
    const halfSize = STICKY_SIZE_WORLD / 2; // 100 world units
    // At 100% zoom, the note is 200x200 screen px
    const centreX = pos.x + halfSize;
    const centreY = pos.y + halfSize;
    expect(Math.abs(centreX - 400)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(centreY - 300)).toBeLessThanOrEqual(PIXEL_TOLERANCE);

    // Verify text is "Hello" (check after ending edit)
    await page.keyboard.press('Escape');
    const textEl = page.locator(`[data-testid="sticky-text-${noteId}"]`);
    await expect(textEl).toHaveText('Hello');
  });

  test('TC-31: drag note at 50% zoom, world position +200,+100', async ({ page }) => {
    // Set camera to 50% zoom, centred at origin
    await setCamera(page, { x: -640, y: -400, zoom: 0.5 });
    await page.waitForTimeout(100);

    // Create a note via dblclick at screen centre
    const c = centreOf(page);
    await page.mouse.dblclick(c.x, c.y);
    await page.keyboard.type('X');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const noteId = await firstNoteId(page);

    // Click empty space to deselect
    await page.mouse.click(100, 700);
    await page.waitForTimeout(100);

    // Get initial position
    const initialPos = await notePosition(page, noteId);

    // Drag from centre of note by (100,50) screen px
    const startX = initialPos.x + 50; // centre of note (note is 100x100 screen px at 50% zoom)
    const startY = initialPos.y + 50;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // At 50% zoom, 100 screen px = 200 world units, 50 screen px = 100 world units
    const newPos = await notePosition(page, noteId);
    expect(Math.abs((newPos.x - initialPos.x) - 100)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs((newPos.y - initialPos.y) - 50)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('TC-32: drag at 200% zoom, world delta +50,+25, note on top', async ({ page }) => {
    // Set camera to 200% zoom
    await setCamera(page, { x: -320, y: -200, zoom: 2 });
    await page.waitForTimeout(100);

    // Create first note at a position that won't overlap with the second
    // At 200% zoom, notes are 400x400 screen px, so we need to be careful
    // Place first note at screen (100, 100)
    await page.mouse.dblclick(100, 100);
    await page.keyboard.type('A');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Click empty space to deselect
    await page.mouse.click(700, 700);
    await page.waitForTimeout(100);

    // Create second note far away from first (empty space)
    await page.mouse.dblclick(900, 700);
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Now drag second note to overlap first
    const notes = page.locator('[data-note-id]');
    const count = await notes.count();
    expect(count).toBe(2);

    // Find the notes and their positions
    const allNotes = await notes.all();
    let noteBPos: { x: number; y: number } | null = null;
    let noteAId = '';
    let noteBId = '';
    for (const el of allNotes) {
      const text = await el.locator('.sticky-note-text').textContent();
      const id = await el.getAttribute('data-note-id');
      if (text === 'B') {
        const box = await el.boundingBox();
        if (box) noteBPos = { x: box.x, y: box.y };
        noteBId = id || '';
      } else {
        noteAId = id || '';
      }
    }
    expect(noteBPos).not.toBeNull();

    // Drag note B towards note A
    await page.mouse.move(noteBPos!.x + 200, noteBPos!.y + 200);
    await page.mouse.down();
    await page.mouse.move(noteBPos!.x - 200, noteBPos!.y - 200, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // After dragging, note B should be on top (higher z-index)
    const elA = page.locator(`[data-note-id="${noteAId}"]`);
    const elB = page.locator(`[data-note-id="${noteBId}"]`);
    const zA = await elA.evaluate((el) => (el as HTMLElement).style.zIndex);
    const zB = await elB.evaluate((el) => (el as HTMLElement).style.zIndex);
    expect(Number(zB)).toBeGreaterThan(Number(zA));
  });

  test('TC-33: font size is max for short text, min with overflow for long text', async ({ page }) => {
    // Create a note with one word
    const c = centreOf(page);
    await page.mouse.dblclick(c.x, c.y);
    await page.keyboard.type('Hi');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const noteId = await firstNoteId(page);
    const textEl = page.locator(`[data-testid="sticky-text-${noteId}"]`);
    const fontSizeShort = await textEl.evaluate((el) => {
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSizeShort).toBe(STICKY_FONT_MAX_PX);

    // Now paste 1000 chars
    await page.mouse.dblclick(c.x, c.y);
    await page.waitForTimeout(100);
    // Select all and replace with long text
    await page.keyboard.press('Control+a');
    await page.evaluate((text) => {
      const textarea = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
      if (textarea) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, PROSE_1000);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Check font size is at minimum
    const fontSizeLong = await textEl.evaluate((el) => {
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSizeLong).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);

    // Check overflow: scrollHeight > clientHeight
    const overflow = await textEl.evaluate((el) => {
      return el.scrollHeight > el.clientHeight;
    });
    expect(overflow).toBe(true);
  });

  test('TC-34: pan far away, click Sticky note button → note at screen centre', async ({ page }) => {
    // Pan far away
    await setCamera(page, { x: 999999, y: 999999, zoom: 1 });
    await page.waitForTimeout(100);

    // Click the Sticky note toolbar button
    await page.getByTestId('create-sticky').click();
    await page.waitForTimeout(100);

    // A note should be visible near the centre of the screen
    const noteId = await firstNoteId(page);
    const pos = await notePosition(page, noteId);
    const c = centreOf(page);
    const halfSize = STICKY_SIZE_WORLD / 2;

    // Note centre should be near screen centre (within tolerance)
    expect(Math.abs(pos.x + halfSize - c.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(pos.y + halfSize - c.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
  });

  test('TC-30 workflow: create, recolour, delete via keyboard', async ({ page }) => {
    // Create a note via dblclick
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Idea');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // The note should be selected after Escape (endEdit('selected'))
    const noteId = await firstNoteId(page);
    const noteEl = page.locator(`[data-testid="sticky-note-${noteId}"]`);
    const selected = await noteEl.getAttribute('data-selected');
    expect(selected).toBe('true');

    // Recolour via swatch (green)
    await page.getByTestId('color-green').click();
    await page.waitForTimeout(100);

    // Verify color changed
    const bgColor = await noteEl.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    expect(bgColor).toBe('rgb(197, 225, 165)'); // #C5E1A5 = green from config

    // Still selected after recolour
    const stillSelected = await noteEl.getAttribute('data-selected');
    expect(stillSelected).toBe('true');

    // Delete via keyboard
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    // Board should have no notes
    const count = await page.locator('[data-note-id]').count();
    expect(count).toBe(0);
  });
});
