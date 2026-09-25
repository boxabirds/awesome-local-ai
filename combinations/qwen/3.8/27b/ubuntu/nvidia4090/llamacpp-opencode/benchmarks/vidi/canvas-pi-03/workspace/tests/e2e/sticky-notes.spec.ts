import { test, expect } from '@playwright/test';
import { getNotes, gotoBoard, setCamera, waitForNoteBox } from './helpers/board';
import { LONG_PROSE, SHORT_TEXT } from '../fixtures/texts';

/**
 * The chromium project uses devices['Desktop Chrome'], whose viewport
 * (1280x720) overrides the global config, so the initial camera is
 * {x:-640, y:-360, zoom:1} and screen (sx,sy) maps to world (sx-640, sy-360).
 */

test.describe('Sticky notes: create, edit, move', () => {
  test('TC-30: double-click at (400,300) centres a note there; typing saves text', async ({ page }) => {
    await gotoBoard(page);
    await page.mouse.dblclick(400, 300);

    const note = page.locator('[data-testid="sticky-note"]');
    await expect(note).toHaveCount(1);
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - 300)).toBeLessThanOrEqual(1);

    // Editing starts automatically; type into the focused textarea.
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.type('Hello');

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Hello');
    expect(notes[0].x).toBeCloseTo(-340, 5);
    expect(notes[0].y).toBeCloseTo(-160, 5);
  });

  test('TC-31: drag by (100,50) at 50% zoom moves (200,100) world; grabbed point stays under pointer', async ({
    page,
  }) => {
    await gotoBoard(page);
    await page.mouse.dblclick(640, 360);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    const id = notes[0].id;

    // Zoom to 50%, keeping the viewport centre fixed: world (0,0) -> screen (320,180).
    await setCamera(page, { x: -640, y: -360, zoom: 0.5 });
    await waitForNoteBox(page, id, { x: 270, y: 130, width: 100, height: 100 });

    await page.mouse.move(320, 180);
    await page.mouse.down();
    await page.mouse.move(420, 230, { steps: 10 });
    await page.mouse.up();

    const after = (await getNotes(page))[0];
    expect(after.x).toBeCloseTo(100, 5); // -100 + 200
    expect(after.y).toBeCloseTo(0, 5); // -100 + 100

    // The grabbed point (the note centre) sits under the pointer within 1px.
    const box = await page.locator(`[data-id="${id}"]`).boundingBox();
    expect(Math.abs(box!.x + box!.width / 2 - 420)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - 230)).toBeLessThanOrEqual(1);
  });

  test('TC-32: drag by (100,50) at 200% zoom moves (50,25) world; dragged note ends above the overlapped one', async ({
    page,
  }) => {
    await gotoBoard(page);
    // Two overlapping notes: A at world centre (0,0), B at (150,0). B's centre
    // is outside A (so the double-click creates instead of editing) while the
    // notes still overlap (|Δ| < note size).
    await page.mouse.dblclick(640, 360);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(790, 360);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');

    let notes = await getNotes(page);
    expect(notes).toHaveLength(2);
    const [a, b] = notes; // sorted by z: B (created last) is on top
    const aId = a.id;
    const bId = b.id;

    // Zoom to 200%, keeping the viewport centre fixed.
    await setCamera(page, { x: -320, y: -180, zoom: 2 });
    await waitForNoteBox(page, aId, { x: 440, y: 160, width: 400, height: 400 });
    await waitForNoteBox(page, bId, { x: 740, y: 160, width: 400, height: 400 });

    // Grab A (the note underneath) at its centre: B covers only x >= 740.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(740, 410, { steps: 10 });
    await page.mouse.up();

    notes = await getNotes(page);
    const aAfter = notes.find((n) => n.id === aId)!;
    const bAfter = notes.find((n) => n.id === bId)!;
    expect(aAfter.x).toBeCloseTo(-50, 5); // -100 + 50
    expect(aAfter.y).toBeCloseTo(-75, 5); // -100 + 25
    expect(bAfter.x).toBeCloseTo(50, 5);
    expect(bAfter.y).toBeCloseTo(-100, 5);
    // A was dragged, so it is now above B.
    expect(aAfter.z).toBeGreaterThan(bAfter.z);
  });
});

test.describe('Sticky notes: text fits, then clips', () => {
  test('TC-33: one word fits at 24px; 1,000 characters shrink to 10px and fade', async ({ page }) => {
    await gotoBoard(page);
    await page.mouse.dblclick(640, 360);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    const text = page.locator('[data-testid="sticky-note-text"] div');
    await expect(text).toHaveCSS('font-size', '24px');
    expect(await page.locator('[data-testid="sticky-note-fade"]').count()).toBe(0);

    // Re-enter editing and paste the full 1,000-character paragraph.
    await page.keyboard.press('Enter');
    const ta = page.locator('[data-testid="sticky-textarea"]');
    await expect(ta).toBeVisible();
    await ta.fill(LONG_PROSE);
    const editingSize = await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(editingSize).toBeGreaterThanOrEqual(10);
    expect(editingSize).toBeLessThan(24);

    await page.keyboard.press('Escape');
    await expect(text).toHaveCSS('font-size', '10px');
    await expect(page.locator('[data-testid="sticky-note-fade"]')).toBeVisible();

    const notes = await getNotes(page);
    expect(notes[0].text.length).toBe(1000);
  });
});

test.describe('Sticky notes: create while far away', () => {
  test('TC-34: after panning far away, the toolbar button creates a note at the screen centre', async ({ page }) => {
    await gotoBoard(page);

    // Pan far away from the origin.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(200, 150, { steps: 5 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Sticky note' }).click();

    const note = page.locator('[data-testid="sticky-note"]');
    await expect(note).toHaveCount(1);
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y + box!.height / 2 - 360)).toBeLessThanOrEqual(2);
  });
});

test.describe('Golden path: brainstorm a board', () => {
  test('create by double-click, type, move at 50% zoom, recolour, delete', async ({ page }) => {
    await gotoBoard(page);

    // 1. Create by double-click at (500,300): world centre (-140,-60).
    await page.mouse.dblclick(500, 300);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();

    // 2. Type a short idea and finish editing.
    await page.keyboard.type(SHORT_TEXT);
    await page.keyboard.press('Escape');
    let notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe(SHORT_TEXT);
    const id = notes[0].id;

    // 3. Zoom to 50%: the note centre is at screen (250,150), size 100x100.
    await setCamera(page, { x: -640, y: -360, zoom: 0.5 });
    await waitForNoteBox(page, id, { x: 200, y: 100, width: 100, height: 100 });
    const before = (await getNotes(page))[0];

    // 4. Move it by (80,40) screen px = (160,80) world px.
    await page.mouse.move(250, 150);
    await page.mouse.down();
    await page.mouse.move(330, 190, { steps: 8 });
    await page.mouse.up();
    let after = (await getNotes(page))[0];
    expect(after.x - before.x).toBeCloseTo(160, 5);
    expect(after.y - before.y).toBeCloseTo(80, 5);

    // 5. Recolour to green from the note toolbar.
    await page.getByRole('button', { name: 'Green colour' }).click();
    after = (await getNotes(page))[0];
    expect(after.color).toBe('green');

    // 6. Delete the note.
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(page.locator('[data-testid="sticky-note"]')).toHaveCount(0);
    expect(await getNotes(page)).toHaveLength(0);
  });
});
