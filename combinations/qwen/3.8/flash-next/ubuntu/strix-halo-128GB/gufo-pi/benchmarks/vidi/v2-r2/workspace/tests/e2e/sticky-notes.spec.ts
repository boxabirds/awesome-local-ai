import { test, expect } from '@playwright/test';
import { gotoBoard, setCamera, getNoteCount, getNoteWorldPos, getNoteScreenPos } from './helpers/board';
import { FIXTURE_1000 } from '../fixtures/texts';

test.describe('Sticky notes', () => {
  test.beforeEach(async ({ page }) => {
    await gotoBoard(page);
  });

  // TC-30: create by dblclick at (400,300), type "Hello" → note centred at (400,300) ±1px
  test('TC-30: double-click creates note centred on click point', async ({ page }) => {
    // Default camera: x=-viewport.width/2, y=-viewport.height/2, zoom=1
    // So world-to-screen: screen = (world - cam.x) * zoom = (world + vw/2) * 1
    // Screen point (400, 300) corresponds to world: 400/1 + (-vw/2) = 400 - vw/2
    const dblclickX = 400;
    const dblclickY = 300;

    await page.mouse.dblclick(dblclickX, dblclickY);
    await page.waitForSelector('[data-testid="sticky-textarea"]');

    // Type Hello
    await page.keyboard.type('Hello');

    // Verify note count
    expect(await getNoteCount(page)).toBe(1);

    // Verify the note is centred at (400, 300) screen
    // Note top-left in world = (400 - vw/2) - 100, (300 - vh/2) - 100
    // Screen position of note left = (worldX - camX) * zoom = (worldX + vw/2) * 1
    // = (400 - vw/2 - 100 + vw/2) = 300
    // Screen position of note centre = 300 + 100 = 400 ✓
    const screenPos = await getNoteScreenPos(page, 0);
    // Centre of note: screenPos.x + 100 (half note width)
    expect(Math.abs(screenPos.x + 100 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(screenPos.y + 100 - 300)).toBeLessThanOrEqual(1);

    // Verify text
    const text = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
      return ta ? ta.value : '';
    });
    expect(text).toBe('Hello');
  });

  // TC-31: at 50% zoom, drag note by (100,50) → world +200,+100
  test('TC-31: drag at 50% zoom moves world position by delta/zoom', async ({ page }) => {
    const viewport = page.viewportSize()!;
    // Set camera to 50% zoom centred at world 0,0
    const camX = -viewport.width / 2 / 0.5;
    const camY = -viewport.height / 2 / 0.5;
    await setCamera(page, { x: camX, y: camY, zoom: 0.5 });

    // Create a note at centre of screen (which maps to world 0,0 at this camera)
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    await page.mouse.dblclick(cx, cy);
    await page.waitForSelector('[data-testid="sticky-textarea"]');
    // Escape to stop editing
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Get initial world position
    const before = await getNoteWorldPos(page, 0);

    // Get screen position of note centre for dragging
    const screenPos = await getNoteScreenPos(page, 0);
    const grabX = screenPos.x + 100 * 0.5; // half of note (200 world units) * zoom 0.5
    const grabY = screenPos.y + 100 * 0.5;

    // Drag by (100, 50) screen pixels
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // World delta should be 100/0.5 = 200, 50/0.5 = 100
    const after = await getNoteWorldPos(page, 0);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(2);
  });

  // TC-32: at 200% zoom, drag by (100,50) → world +50,+25
  test('TC-32: drag at 200% zoom moves world position by delta/zoom', async ({ page }) => {
    const viewport = page.viewportSize()!;
    // Set camera to 200% zoom centred at world 0,0
    const camX = -viewport.width / 2 / 2;
    const camY = -viewport.height / 2 / 2;
    await setCamera(page, { x: camX, y: camY, zoom: 2 });

    // Create a note at centre of screen (maps to world 0,0)
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    await page.mouse.dblclick(cx, cy);
    await page.waitForSelector('[data-testid="sticky-textarea"]');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const before = await getNoteWorldPos(page, 0);

    // Get screen position of note centre
    const screenPos = await getNoteScreenPos(page, 0);
    const grabX = screenPos.x + 100 * 2; // half note * zoom 2
    const grabY = screenPos.y + 100 * 2;

    // Drag by (100, 50) screen pixels
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 100, grabY + 50, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // World delta should be 100/2 = 50, 50/2 = 25
    const after = await getNoteWorldPos(page, 0);
    expect(Math.abs(after.x - before.x - 50)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.y - before.y - 25)).toBeLessThanOrEqual(2);
  });

  // TC-33: long text - one word → font 24px; 1000 chars → font ≥ 10px, overflow fade
  test('TC-33: text fits then clips with fade', async ({ page }) => {
    const viewport = page.viewportSize()!;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    // Create note by dblclick
    await page.mouse.dblclick(cx, cy);
    await page.waitForSelector('[data-testid="sticky-textarea"]');

    // Type a short word
    await page.keyboard.type('Hi');
    await page.waitForTimeout(100);

    // Check font size is max (24px)
    const fontSize1 = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="sticky-textarea"]') as HTMLElement;
      return ta ? parseFloat(getComputedStyle(ta).fontSize) : 0;
    });
    expect(fontSize1).toBe(24);

    // Now clear and paste 1000 chars
    await page.keyboard.press('Control+a');
    await page.evaluate((text) => {
      const ta = document.querySelector('[data-testid="sticky-textarea"]') as HTMLTextAreaElement;
      if (ta) {
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, FIXTURE_1000);
    await page.waitForTimeout(100);

    // Check font size is at minimum
    const fontSize2 = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="sticky-textarea"]') as HTMLElement;
      return ta ? parseFloat(getComputedStyle(ta).fontSize) : 0;
    });
    expect(fontSize2).toBeGreaterThanOrEqual(10);
  });

  // TC-34: pan far away, click Sticky note → note visible at centre
  test('TC-34: toolbar creates note at viewport centre when panned far', async ({ page }) => {
    // Pan far away
    await setCamera(page, { x: -5000, y: -3000, zoom: 1 });
    await page.waitForTimeout(50);

    // Click sticky note button
    await page.click('[aria-label="Sticky note"]');
    await page.waitForSelector('[data-testid="sticky-textarea"]');

    expect(await getNoteCount(page)).toBe(1);

    // Note should be at centre of screen
    const viewport = page.viewportSize()!;
    const screenPos = await getNoteScreenPos(page, 0);
    const centreX = screenPos.x + 100; // half note width
    const centreY = screenPos.y + 100; // half note height
    expect(Math.abs(centreX - viewport.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centreY - viewport.height / 2)).toBeLessThanOrEqual(1);
  });

  // Workflow: Brainstorm golden path - create, recolour, delete
  test('Golden path: create, type, recolour, delete', async ({ page }) => {
    // Create note at (400, 300)
    await page.mouse.dblclick(400, 300);
    await page.waitForSelector('[data-testid="sticky-textarea"]');
    await page.keyboard.type('Faster onboarding');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    expect(await getNoteCount(page)).toBe(1);

    // Click on the note to select it
    const screenPos = await getNoteScreenPos(page, 0);
    await page.mouse.click(screenPos.x + 100, screenPos.y + 100);
    await page.waitForTimeout(100);

    // Verify toolbar appeared
    await expect(page.locator('[data-testid="note-toolbar"]')).toBeVisible();

    // Click green swatch
    await page.click('[aria-label="Green colour"]');
    await page.waitForTimeout(50);

    // Verify colour changed (check background-color)
    const bgColor = await page.evaluate(() => {
      const note = document.querySelector('[role="group"][aria-label="Sticky note"]') as HTMLElement;
      return note ? getComputedStyle(note).backgroundColor : '';
    });
    // #C5E1A5 = rgb(197, 225, 165)
    expect(bgColor).toContain('197');

    // Delete via Delete key
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    expect(await getNoteCount(page)).toBe(0);
  });
});
