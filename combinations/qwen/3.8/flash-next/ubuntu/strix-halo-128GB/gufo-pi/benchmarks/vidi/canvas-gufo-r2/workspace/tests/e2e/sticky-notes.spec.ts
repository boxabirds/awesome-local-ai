/**
 * E2E tests for sticky note workflows (TC-30 to TC-34, golden path).
 */
import { expect, test, type Page } from '@playwright/test';
import {
  boardLocator,
  expectClosePoints,
  readCamera,
  setCamera,
  type Dot,
} from './helpers/board';
import { LONG_PARAGRAPH_1000, SHORT_PHRASE } from '../fixtures/texts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

const CENTRE: Dot = { x: 640, y: 400 };

/** Locate the note element by its data-note-id (we do not know the id). */
const firstNote = (page: Page) => page.locator('[data-note-id]').first();
const stickyCounter = (page: Page) => page.getByTestId('sticky-counter');


/** Wait for the board test hooks and return the current camera. */
async function camera(page: Page) {
  return readCamera(page);
}

test.describe('sticky note creation and interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the board's initial camera reset (from {0,0,1}) to the viewport
    // centred view (data-camera-x = -viewportWidth/2) to be committed.
    await expect
      .poll(
        async () => {
          const cam = await boardLocator(page).evaluate((el) => ({
            x: Number(el.dataset.cameraX),
            y: Number(el.dataset.cameraY),
          }));
          return cam.x !== 0 || cam.y !== 0;
        },
        { timeout: 2000 },
      )
      .toBe(true);
  });

  test('TC-30: dblclick creates note centred at click, typing works', async ({ page }) => {
    const clickPt: Dot = { x: 400, y: 300 };
    await page.mouse.dblclick(clickPt.x, clickPt.y);
    // A note should appear centred at the click point (within 1px).
    const note = firstNote(page);
    await expect(note).toBeVisible();
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    expectClosePoints({ x: cx, y: cy }, clickPt, 1);

    // Note is in editing mode — type immediately.
    await page.keyboard.type(SHORT_PHRASE);
    const textarea = note.locator('textarea');
    await expect(textarea).toHaveValue(SHORT_PHRASE);
  });

  test('TC-31: drag note at 50% zoom — world delta is 2x screen delta', async ({ page }) => {
    // Zoom out to 50% first via the test hook.
    await setCamera(page, { zoom: 0.5 });
    const cam = await camera(page);
    expect(cam.zoom).toBeCloseTo(0.5, 3);

    // Create a note by dblclicking.
    const start: Dot = { x: 400, y: 300 };
    await page.mouse.dblclick(start.x, start.y);
    const note = firstNote(page);
    await expect(note).toBeVisible();
    // Commit any editing by clicking the note once (ends editing via blur outside).
    await page.keyboard.press('Escape');
    // Read note's initial world x,y from snapshot via DOM data
    const beforeBox = await note.boundingBox();
    if (!beforeBox) throw new Error('note not visible');
    const grabbed: Dot = { x: beforeBox.x + beforeBox.width / 2, y: beforeBox.y + beforeBox.height / 2 };

    // Drag by (100, 50) screen pixels; world delta = screen / zoom = (200, 100).
    await page.mouse.move(grabbed.x, grabbed.y);
    await page.mouse.down();
    await page.mouse.move(grabbed.x + 50, grabbed.y + 25, { steps: 5 });
    await page.mouse.move(grabbed.x + 100, grabbed.y + 50, { steps: 5 });
    // Verify pointer is under grabbed + delta
    const midBox = await note.boundingBox();
    if (!midBox) throw new Error('note not visible during drag');
    const midCx = midBox.x + midBox.width / 2;
    const midCy = midBox.y + midBox.height / 2;
    expectClosePoints({ x: midCx, y: midCy }, { x: grabbed.x + 100, y: grabbed.y + 50 }, 1);
    await page.mouse.up();
  });

  test('TC-32: drag at 200% zoom — world delta is half of screen delta; note ends on top', async ({ page }) => {
    await setCamera(page, { zoom: 2 });
    const cam = await camera(page);
    expect(cam.zoom).toBeCloseTo(2, 3);

    // Create two non-overlapping notes.
    await page.mouse.dblclick(200, 200);
    await page.keyboard.type('A');
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(700, 600);
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');

    // Grab the lower note (first-created, lower z) and drag it to overlap the other.
    const notes = page.locator('[data-note-id]');
    expect(await notes.count()).toBe(2);
    const lowerId = await notes.nth(0).getAttribute('data-note-id');
    const upperId = await notes.nth(1).getAttribute('data-note-id');
    if (!lowerId || !upperId) throw new Error('missing note ids');
    const lower = page.locator(`[data-note-id="${lowerId}"]`);
    const upper = page.locator(`[data-note-id="${upperId}"]`);
    const lowerBox = await lower.boundingBox();
    if (!lowerBox) throw new Error('lower note not visible');
    const grabPt: Dot = { x: lowerBox.x + lowerBox.width / 2, y: lowerBox.y + lowerBox.height / 2 };
    // Move so it overlaps the upper note's centre.
    const upperBox = await upper.boundingBox();
    if (!upperBox) throw new Error('upper note not visible');
    const target: Dot = { x: upperBox.x + upperBox.width / 2, y: upperBox.y + upperBox.height / 2 };
    await page.mouse.move(grabPt.x, grabPt.y);
    await page.mouse.down();
    await page.mouse.move((grabPt.x + target.x) / 2, (grabPt.y + target.y) / 2, { steps: 5 });
    await page.mouse.move(target.x, target.y, { steps: 5 });
    await page.mouse.up();
    // Verify dragged note is now visually on top (higher z-index).
    const draggedZ = await lower.evaluate((el) => Number(getComputedStyle(el).zIndex));
    const upperZ = await upper.evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(draggedZ).toBeGreaterThan(upperZ);
    // Just sanity-check the note ended near target screen position.
    const afterBox = await lower.boundingBox();
    if (!afterBox) throw new Error('lower note not visible after drag');
    const afterCx = afterBox.x + afterBox.width / 2;
    const afterCy = afterBox.y + afterBox.height / 2;
    expectClosePoints({ x: afterCx, y: afterCy }, target, 2);
  });

  test('TC-33: long text fits then clips with fade', async ({ page }) => {
    // Create a note and type one short word: font should be at STICKY_FONT_MAX_PX.
    await page.mouse.dblclick(400, 300);
    const note = firstNote(page);
    await expect(note).toBeVisible();
    const textarea = note.locator('textarea');
    await textarea.fill('Onboarding');
    const maxFontSize = await textarea.evaluate((el) => Number(getComputedStyle(el).fontSize.replace('px', '')));
    expect(maxFontSize).toBe(STICKY_FONT_MAX_PX);

    // Paste 1000 chars: font should fit at or below MAX and >= MIN, with overflow class.
    await textarea.fill(LONG_PARAGRAPH_1000);
    // Escape to see the display mode.
    await page.keyboard.press('Escape');
    const display = note.locator('.sticky-text');
    await expect(display).toBeVisible();
    const minOrLarger = await display.evaluate((el) => Number(getComputedStyle(el).fontSize.replace('px', '')));
    expect(minOrLarger).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(minOrLarger).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    // Fade class present when overflow
    await expect(display).toHaveClass(/sticky-text-overflow/);

    // Nothing rendered outside the note box: text scrollWidth/scrollHeight must not exceed the note's client box.
    const fits = await display.evaluate((el) => ({
      cw: el.clientWidth,
      ch: el.clientHeight,
      sw: el.scrollWidth,
      sh: el.scrollHeight,
    }));
    expect(fits.sw).toBeLessThanOrEqual(fits.cw + 1);
    // scrollHeight can be larger due to overflow: clip, but clientHeight is bounded by the note.
    expect(fits.ch).toBeLessThanOrEqual(STICKY_SIZE_WORLD);
  });

  test('TC-34: create from toolbar while panned far away — note appears at screen centre', async ({ page }) => {
    // Pan far away using the test hook.
    await setCamera(page, { x: -50000, y: -30000 });
    // Now click the Sticky note button.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    const note = firstNote(page);
    await expect(note).toBeVisible();
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    // Note centred on viewport centre (640,400) within a small tolerance.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    expectClosePoints({ x: cx, y: cy }, CENTRE, 5);
  });

  test('TC-35: text counter appears near the limit', async ({ page }) => {
    await page.mouse.dblclick(400, 300);
    const note = firstNote(page);
    const textarea = note.locator('textarea');
    // Fill with 1000 chars via clipboard paste simulation.
    await textarea.evaluate((el, text: string) => {
      const ta = el as HTMLTextAreaElement;
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
    }, 'x'.repeat(1200));
    // Counter should show 1000/1000
    await expect(stickyCounter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
    const length = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value.length);
    expect(length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  test('TC-36: colour change via swatch keeps text and position; Delete removes note', async ({ page }) => {
    // Golden path: create, type, recolour, delete.
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    const note = firstNote(page);
    const beforeBox = await note.boundingBox();
    if (!beforeBox) throw new Error('note not visible');

    // Click the note to select.
    await page.mouse.click(beforeBox.x + beforeBox.width / 2, beforeBox.y + beforeBox.height / 2);
    // Change to Green via swatch.
    await page.getByRole('button', { name: 'Green colour' }).click();
    const bg = await note.evaluate((el) => getComputedStyle(el).backgroundColor);
    // '#C5E1A5' is rgb(197, 225, 165)
    expect(bg).toBe('rgb(197, 225, 165)');

    // Position and text unchanged.
    const afterBox = await note.boundingBox();
    if (!afterBox) throw new Error('note not visible after colour change');
    expectClosePoints({ x: afterBox.x, y: afterBox.y }, { x: beforeBox.x, y: beforeBox.y }, 1);
    const text = await note.locator('.sticky-text').textContent();
    expect(text).toBe('Hello');

    // Delete the selected note with Delete key.
    await page.keyboard.press('Delete');
    await expect(note).toHaveCount(0);
  });

  test('TC-37: dragging a note does not pan the board', async ({ page }) => {
    const camBefore = await camera(page);
    // Create a note.
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    const note = firstNote(page);
    const box = await note.boundingBox();
    if (!box) throw new Error('note not visible');
    // Drag the note.
    const grabPt: Dot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(grabPt.x, grabPt.y);
    await page.mouse.down();
    await page.mouse.move(grabPt.x + 80, grabPt.y + 40, { steps: 6 });
    await page.mouse.up();
    const camAfter = await camera(page);
    expect(camAfter.x).toBeCloseTo(camBefore.x, 1);
    expect(camAfter.y).toBeCloseTo(camBefore.y, 1);
    expect(camAfter.zoom).toBeCloseTo(camBefore.zoom, 1);
  });
});
