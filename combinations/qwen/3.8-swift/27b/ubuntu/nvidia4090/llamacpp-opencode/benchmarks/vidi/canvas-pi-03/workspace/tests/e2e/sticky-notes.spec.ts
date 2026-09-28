import { test, expect } from '@playwright/test';
import { setCamera, getNotes, getNoteCenter, createBoardIdForPage } from './helpers/board';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_SIZE_WORLD } from 'src/shared/config';
import { LONG_TEXT, assertLongTextLength } from '../fixtures/texts';

assertLongTextLength();

/**
 * Load the board and wait until React has committed and the test hook is
 * available (the hook is set in a post-mount effect, so this guarantees the
 * app is interactive — a dblclick dispatched before React attaches its
 * listeners is lost).
 */
async function openBoard(page: import('@playwright/test').Page) {
  // Story 5: create the board through the API first — an unknown link is
  // "Board not found", not a fresh board.
  const id = await createBoardIdForPage(page);
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
}

/** Camera that keeps world point `world` at the screen centre for a given zoom. */
async function cameraCentering(page: import('@playwright/test').Page, world: { x: number; y: number }, zoom: number) {
  const { width, height } = page.viewportSize()!;
  await setCamera(page, world.x - width / 2 / zoom, world.y - height / 2 / zoom, zoom);
}

test.describe('Workflow: Brainstorm golden path', () => {
  test('TC-30: real dblclick at (400,300) creates a note centred there; typed text shows', async ({ page }) => {
    await openBoard(page);

    await page.mouse.dblclick(400, 300);

    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();

    // The note opens in edit mode with the caret ready: type straight in.
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - 300)).toBeLessThanOrEqual(1);

    // Text is stored in the doc and displayed.
    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Hello');
    await expect(page.getByTestId('sticky-note-text')).toHaveText('Hello');
  });

  test('TC-31: at 50% zoom a (100,50) drag moves the note +200,+100 world with the grabbed point under the pointer; recolour; delete', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;
    const cx = width / 2;
    const cy = height / 2;

    // Create note A at the board centre (world 0,0 at zoom 1).
    await page.mouse.dblclick(cx, cy);
    await page.keyboard.type('A');
    await page.keyboard.press('Escape');
    let notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    const a = notes[0];
    // Created centred on the screen centre (world 0,0); x,y are the top-left.
    expect(a.x).toBe(-STICKY_SIZE_WORLD / 2);
    expect(a.y).toBe(-STICKY_SIZE_WORLD / 2);

    // Zoom to 50% keeping world (0,0) at the screen centre.
    await cameraCentering(page, { x: 0, y: 0 }, 0.5);
    const start = await getNoteCenter(page, a.id);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 8 });
    await page.mouse.up();

    // The grabbed point stays under the pointer.
    const afterDrag = await getNoteCenter(page, a.id);
    expect(Math.abs(afterDrag.x - (start.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(afterDrag.y - (start.y + 50))).toBeLessThanOrEqual(1);

    // World position moved by 100/0.5 = 200, 50/0.5 = 100.
    notes = await getNotes(page);
    expect(notes[0].x).toBe(a.x + 200);
    expect(notes[0].y).toBe(a.y + 100);

    // Recolour via the swatch (select first — the drag left it selected).
    await page.getByRole('button', { name: 'Green colour' }).click();
    notes = await getNotes(page);
    expect(notes[0].color).toBe('green');

    // Create note B (well clear of the moved A), then delete A: the board keeps exactly B.
    await page.mouse.dblclick(cx - 260, cy + 200);
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');
    notes = await getNotes(page);
    expect(notes).toHaveLength(2);
    const b = notes.find((n) => n.text === 'B')!;
    expect(b).toBeDefined();

    // Select A and delete it.
    await getNoteCenter(page, a.id).then(async (p) => {
      await page.mouse.click(p.x, p.y);
    });
    await page.keyboard.press('Delete');
    notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(b.id);
    expect(notes[0].text).toBe('B');
  });

  test('TC-32: at 200% zoom a (100,50) drag moves the note +50,+25 world and brings it above an overlapped note', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;
    const cx = width / 2;
    const cy = height / 2;

    // Two overlapping notes: A centred on world (0,0), B on world (160,0)
    // (160 < note width 200, so they overlap; 160 > 100, so the second
    // dblclick lands on empty board space, not on A).
    await page.mouse.dblclick(cx, cy);
    await page.keyboard.type('A');
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(cx + 160, cy);
    await page.keyboard.type('B');
    await page.keyboard.press('Escape');

    let notes = await getNotes(page);
    expect(notes).toHaveLength(2);
    const a = notes.find((n) => n.text === 'A')!;
    const b = notes.find((n) => n.text === 'B')!;
    expect(a.z).toBeLessThan(b.z); // B was created last, so it is on top

    // 200% zoom centred on the overlap.
    await cameraCentering(page, { x: 80, y: 0 }, 2);
    const start = await getNoteCenter(page, a.id);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 100, start.y + 50, { steps: 8 });
    await page.mouse.up();

    notes = await getNotes(page);
    const aAfter = notes.find((n) => n.id === a.id)!;
    const bAfter = notes.find((n) => n.id === b.id)!;
    // World moved by 100/2 = 50, 50/2 = 25.
    expect(aAfter.x).toBe(a.x + 50);
    expect(aAfter.y).toBe(a.y + 25);
    // The dragged note is now drawn above the overlapped note.
    expect(aAfter.z).toBeGreaterThan(bAfter.z);
  });

  test('TC-33: one word renders at the max font; 1,000 chars shrink to the min, fade in, and stay clipped', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;

    await page.mouse.dblclick(width / 2, height / 2);

    // One word → max font size.
    await page.keyboard.type('Hello');
    const textEl = page.getByTestId('sticky-note-text');
    const maxFont = await textEl.evaluate((el) => getComputedStyle(el).fontSize);
    expect(maxFont).toBe(`${STICKY_FONT_MAX_PX}px`);

    // The full 1,000-character fixture.
    await page.keyboard.insertText(LONG_TEXT);
    await page.keyboard.press('Escape');

    const font = await textEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(font).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);

    // Overflow: content taller than the box, fade shown, clipped to the note.
    const clip = await textEl.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflow: getComputedStyle(el).overflow,
    }));
    expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
    expect(clip.overflow).toBe('hidden');
    await expect(page.getByTestId('sticky-note-fade')).toBeVisible();

    const noteBox = await page.getByTestId('sticky-note').boundingBox();
    const textBox = await textEl.boundingBox();
    expect(noteBox).not.toBeNull();
    expect(textBox).not.toBeNull();
    // Nothing is rendered outside the note box.
    expect(textBox!.x).toBeGreaterThanOrEqual(noteBox!.x - 1);
    expect(textBox!.y).toBeGreaterThanOrEqual(noteBox!.y - 1);
    expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(noteBox!.x + noteBox!.width + 1);
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(noteBox!.y + noteBox!.height + 1);

    const notes = await getNotes(page);
    expect(notes[0].text.length).toBe(1000);
  });

  test('TC-34: panned far away, the Sticky note button creates a note at the screen centre', async ({ page }) => {
    await openBoard(page);
    const { width, height } = page.viewportSize()!;

    // Pan far away from the origin.
    await setCamera(page, -5000, -4000, 1);

    await page.getByRole('button', { name: 'Sticky note' }).click();

    const note = page.getByTestId('sticky-note');
    await expect(note).toBeVisible();
    const box = await note.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - height / 2)).toBeLessThanOrEqual(1);
  });
});
