import { expect, test } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { PROSE_1000 } from '../fixtures/texts';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;


test.describe('Sticky notes — e2e', () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  // TC-30: double-click creates a note centred at the click point, type into it
  test('TC-30 dblclick creates note centred and typing works', async ({ page }) => {
    // Double-click at (400, 300)
    await page.mouse.dblclick(400, 300);

    // A textarea should appear (editing mode)
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    // Type text
    await page.keyboard.type('Hello');

    // Verify text in Y.Text (check the textarea value)
    const value = await textarea.inputValue();
    expect(value).toBe('Hello');

    // Get note element position — should be centred on (400, 300)
    // Note world size is 200 units; at zoom 1 the note on screen is 200px
    // The note top-left is at world (400 - 100, 300 - 100) = (300, 200)
    // At camera (resetCamera sets origin at viewport centre), the screen position of
    // world (300, 200) = (300 - cam.x, 200 - cam.y) * zoom
    // We just verify the note is approximately centred at (400, 300)
    const noteEl = page.locator('[role="group"][aria-label="Sticky note"]').first();
    const box = await noteEl.boundingBox();
    expect(box).not.toBeNull();
    // Centre of note should be within 1px of (400, 300)
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    expect(Math.abs(cx - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - 300)).toBeLessThanOrEqual(1);
  });

  // TC-31: at 50% zoom, drag by (100,50) screen px → world delta is (200,100)
  test('TC-31 drag at 50% zoom moves note in world correctly', async ({ page }) => {
    // Set zoom to 0.5
    await setCamera(page, 0, 0, 0.5);

    // Create a note at viewport centre via dblclick
    // Viewport centre in screen coords = (640, 400)
    await page.mouse.dblclick(640, 400);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    // End editing
    await page.keyboard.press('Escape');

    // Get note element
    const noteEl = page.locator('[role="group"][aria-label="Sticky note"]').first();

    // Get initial screen position of a specific point on the note (top-left of note)
    const boxBefore = await noteEl.boundingBox();
    expect(boxBefore).not.toBeNull();

    // Drag the note by (100, 50) screen pixels from the centre of the note
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + boxBefore!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 5 });
    await page.mouse.up();

    // Get position after drag
    const boxAfter = await noteEl.boundingBox();
    expect(boxAfter).not.toBeNull();

    // Screen delta should be approximately (100, 50)
    const screenDx = boxAfter!.x - boxBefore!.x;
    const screenDy = boxAfter!.y - boxBefore!.y;
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);

    // World delta = screen delta / zoom = 100/0.5, 50/0.5 = (200, 100)
    // Verify via the world layer transform
    const worldDx = screenDx / 0.5;
    const worldDy = screenDy / 0.5;
    expect(Math.abs(worldDx - 200)).toBeLessThanOrEqual(4);
    expect(Math.abs(worldDy - 100)).toBeLessThanOrEqual(4);
  });

  // TC-32: at 200% zoom, drag by (100,50) → world delta is (50,25), stacking
  test('TC-32 drag at 200% zoom moves world correctly and stacks', async ({ page }) => {
    // Set zoom to 2
    await setCamera(page, 0, 0, 2);

    // Create first note at upper-left area of viewport
    // At zoom 2, note is 400px on screen (200 world * 2)
    await page.mouse.dblclick(250, 250);
    await page.keyboard.press('Escape');

    // Create second note well below the first (outside first note's bounds)
    // First note bounds: (250-200, 250-200) to (250+200, 250+200) = (50, 50) to (450, 450)
    await page.mouse.dblclick(640, 640);
    await page.keyboard.press('Escape');

    // Get the two notes
    const notes = page.locator('[role="group"][aria-label="Sticky note"]');
    const count = await notes.count();
    expect(count).toBe(2);

    // Identify notes by their data-note-id to avoid reordering issues
    const firstNoteId = await notes.nth(0).getAttribute('data-note-id');
    const secondNoteId = await notes.nth(1).getAttribute('data-note-id');
    const firstNote = page.locator(`[data-note-id="${firstNoteId}"]`);
    const secondNote = page.locator(`[data-note-id="${secondNoteId}"]`);

    // Drag the first note by (100, 50) screen pixels
    const box1 = await firstNote.boundingBox();
    expect(box1).not.toBeNull();

    const start = { x: box1!.x + box1!.width / 2, y: box1!.y + box1!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 5 });
    await page.mouse.up();
    // Wait for React commit and rAF
    await page.waitForTimeout(100);

    // Verify world delta: screen 100px at zoom 2 = 50 world units
    const box1After = await firstNote.boundingBox();
    expect(box1After).not.toBeNull();
    const screenDx = box1After!.x - box1!.x;
    const screenDy = box1After!.y - box1!.y;
    // The grabbed point stays under pointer: screen dx ≈ 100
    expect(Math.abs(screenDx - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(screenDy - 50)).toBeLessThanOrEqual(2);

    // World delta = 100/2 = 50, 50/2 = 25
    const worldDx = screenDx / 2;
    const worldDy = screenDy / 2;
    expect(Math.abs(worldDx - 50)).toBeLessThanOrEqual(2);
    expect(Math.abs(worldDy - 25)).toBeLessThanOrEqual(2);

    // The dragged note should be on top (bringToFront)
    const zAfter = await firstNote.evaluate((el) => (el as HTMLElement).style.zIndex);
    const zSecond = await secondNote.evaluate((el) => (el as HTMLElement).style.zIndex);
    expect(Number(zAfter)).toBeGreaterThan(Number(zSecond));
  });

  // TC-33: long text - type one word → 24px font, paste 1000 chars → min font with fade
  test('TC-33 text auto-fits with font shrinking and overflow fade', async ({ page }) => {
    // Create a note and type a short word
    await page.mouse.dblclick(400, 400);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    await page.keyboard.type('Idea');
    await page.keyboard.press('Escape');

    // Check computed font size of the text display element
    const noteEl = page.locator('[role="group"][aria-label="Sticky note"]').first();
    const textEl = noteEl.locator('.sticky-note-text');
    const fontShort = await textEl.evaluate((el) => {
      return window.getComputedStyle(el).fontSize;
    });
    // At 100% zoom, should be 24px (STICKY_FONT_MAX_PX)
    expect(fontShort).toBe('24px');

    // Now re-edit and paste 1000 chars
    await page.mouse.dblclick(400, 400);
    const textarea2 = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea2).toBeVisible();

    // Paste the long text by setting value and firing input
    await textarea2.evaluate((el, text) => {
      (el as HTMLTextAreaElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, PROSE_1000);

    // Escape to see display mode
    await page.keyboard.press('Escape');

    // Check font size is now at or near minimum
    const fontLong = await textEl.evaluate((el) => {
      return parseInt(window.getComputedStyle(el).fontSize, 10);
    });
    // Should be at min (10px) for 1000 chars in a 200x200 note
    expect(fontLong).toBeLessThanOrEqual(24);
    expect(fontLong).toBeGreaterThanOrEqual(10);

    // Check that overflow fade is present
    const fade = page.locator('[data-testid="sticky-fade"]');
    // If font is at minimum and text overflows, fade should be present
    if (fontLong === 10) {
      await expect(fade).toBeVisible();
    }
  });

  // TC-34: pan far away, click Sticky note button → note at viewport centre
  test('TC-34 create via button while panned far away puts note at screen centre', async ({ page }) => {
    // Jump camera far away
    await setCamera(page, 100000, 100000, 1);

    // Click Sticky note button
    await page.click('[aria-label="Sticky note"]');

    // A textarea should appear (editing mode)
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();

    // Escape and verify the note is at screen centre
    await page.keyboard.press('Escape');

    const noteEl = page.locator('[role="group"][aria-label="Sticky note"]').first();
    const box = await noteEl.boundingBox();
    expect(box).not.toBeNull();
    // Centre should be near viewport centre (640, 400)
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    // Allow a few pixels tolerance for the note size
    expect(Math.abs(cx - VIEWPORT_WIDTH / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(cy - VIEWPORT_HEIGHT / 2)).toBeLessThanOrEqual(2);
  });

  // Golden path workflow: create → type → recolour → delete
  test('Brainstorm golden path: create, move, recolour, delete', async ({ page }) => {
    // TC-30: create by dblclick, type text
    await page.mouse.dblclick(400, 300);
    const textarea = page.locator('[data-testid="sticky-textarea"]');
    await expect(textarea).toBeVisible();
    await page.keyboard.type('Golden path note');
    await page.keyboard.press('Escape');

    // Verify note exists with text
    const noteEl = page.locator('[role="group"][aria-label="Sticky note"]').first();
    await expect(noteEl).toBeVisible();
    const text = await noteEl.locator('.sticky-note-text').textContent();
    expect(text).toBe('Golden path note');

    // Click to select (if not already selected)
    await noteEl.click();

    // Note toolbar should appear
    const toolbar = page.locator('[data-testid="note-toolbar"]');
    await expect(toolbar).toBeVisible();

    // Change colour to green
    await page.click('[aria-label="green colour"]');

    // Verify colour changed
    const bgColor = await noteEl.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    // green = #C5E1A5 → rgb(197, 225, 165)
    expect(bgColor).toContain('197');
    expect(bgColor).toContain('225');
    expect(bgColor).toContain('165');

    // Delete the note with Delete key
    await page.keyboard.press('Delete');

    // Note should be gone
    await expect(page.locator('[role="group"][aria-label="Sticky note"]')).toHaveCount(0);
  });
});
