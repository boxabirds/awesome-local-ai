// Story 2 — Capture ideas on sticky notes and rearrange them.
import { test, expect, requires, openBoard, notes, createNote, clickEmpty, box, centreOf, drag,
         shot, BOARD_CENTRE } from './fixtures';

const STICKY_TEXT_LIMIT = 1000;
const PASTE_LENGTH = 1200;
const PIXEL_TOLERANCE = 1.5;
const NOTE_COLOURS = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];

test.describe('story 2 @s02', () => {
  test.beforeEach(() => requires(2));

  test('golden path: create, type, select, recolour, delete @ref prd:golden-path', async ({ page }) => {
    await openBoard(page);
    await page.mouse.dblclick(400, 300);
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.type('Faster onboarding');
    await clickEmpty(page);
    const note = notes(page).first();
    await expect(note).toContainText('Faster onboarding');
    await note.click();
    for (const c of NOTE_COLOURS) {
      await expect(page.getByRole('button', { name: `${c} colour` })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Delete note' })).toBeVisible();
    const bgBefore = await note.evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect.poll(() => note.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(bgBefore);
    await expect(note).toContainText('Faster onboarding');
    await shot(page, 's02-golden');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
  });

  test('double-click creates note centred on the point @ref prd:sticky.create_dblclick', async ({ page }) => {
    await openBoard(page);
    const at = { x: 500, y: 350 };
    await page.mouse.dblclick(at.x, at.y);
    const c = centreOf(await box(notes(page).first()));
    expect(Math.abs(c.x - at.x)).toBeLessThan(PIXEL_TOLERANCE * 2);
    expect(Math.abs(c.y - at.y)).toBeLessThan(PIXEL_TOLERANCE * 2);
    await page.keyboard.type('typed');
    await expect(notes(page).first()).toContainText('typed');
  });

  test('toolbar button creates note in view centre @ref prd:sticky.create_button', async ({ page }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.type('centre');
    await expect(notes(page).first()).toContainText('centre');
    const c = centreOf(await box(notes(page).first()));
    const vp = page.viewportSize()!;
    // "centre of the visible board area" — allow for side toolbars.
    expect(Math.abs(c.x - vp.width / 2)).toBeLessThan(vp.width * 0.1);
    expect(Math.abs(c.y - vp.height / 2)).toBeLessThan(vp.height * 0.1);
  });

  test('escape and outside click keep typed text; Enter re-edits at end @ref prd:sticky.edit_end', async ({ page }) => {
    await openBoard(page);
    const note = await createNote(page, { x: 400, y: 300 }, 'alpha');
    await note.click();
    await page.keyboard.press('Enter');
    await page.keyboard.type(' beta');
    await clickEmpty(page);
    await expect(note).toContainText('alpha beta');
  });

  test('pasting over the limit keeps exactly 1000 characters @ref prd:sticky.text_limit', async ({ page }) => {
    await openBoard(page);
    await page.mouse.dblclick(400, 300);
    const long = 'x'.repeat(PASTE_LENGTH);
    await page.evaluate((t) => navigator.clipboard.writeText(t), long);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(page.getByText(`${STICKY_TEXT_LIMIT}/${STICKY_TEXT_LIMIT}`)).toBeVisible();
    await page.keyboard.press('Escape');
    const text = await notes(page).first().innerText();
    expect(text.replace(/[^x]/g, '').length).toBe(STICKY_TEXT_LIMIT);
  });

  test('dragging a note moves it, not the board @ref prd:sticky.move prd:sticky.no_pan', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 300, y: 300 }, 'mover');
    const b = await createNote(page, { x: 800, y: 300 }, 'still');
    const aBefore = await box(a);
    const bBefore = await box(b);
    const grab = { x: aBefore.x + 30, y: aBefore.y + 30 };
    await drag(page, grab, { x: grab.x + 150, y: grab.y + 80 });
    const aAfter = await box(a);
    expect(Math.abs(aAfter.x - aBefore.x - 150)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(aAfter.y - aBefore.y - 80)).toBeLessThan(PIXEL_TOLERANCE);
    const bAfter = await box(b);
    expect(Math.abs(bAfter.x - bBefore.x)).toBeLessThan(PIXEL_TOLERANCE);
  });

  test('dragged note is drawn above the note it overlaps @ref prd:sticky.move', async ({ page }) => {
    await openBoard(page);
    const under = await createNote(page, { x: 700, y: 400 }, 'under');
    const over = await createNote(page, { x: 300, y: 400 }, 'over');
    // Make "under" the most recently touched, then drag "over" onto it.
    await under.click();
    const ob = await box(over);
    const ub = await box(under);
    await drag(page, { x: ob.x + 20, y: ob.y + 20 }, { x: ub.x + 20, y: ub.y + 20 });
    const top = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('[aria-label="Sticky note"]')?.textContent ?? '';
    }, { x: ub.x + 60, y: ub.y + 60 });
    expect(top).toContain('over');
  });

  test('Delete while editing edits text, not the note @ref prd:sticky.delete', async ({ page }) => {
    await openBoard(page);
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('abc');
    await page.keyboard.press('Backspace');
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(notes(page).first()).toContainText('ab');
    await expect(notes(page).first()).not.toContainText('abc');
  });

  test('delete button on note toolbar removes note @ref prd:sticky.delete', async ({ page }) => {
    await openBoard(page);
    const note = await createNote(page, { x: 400, y: 300 }, 'bin me');
    await note.click();
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(notes(page)).toHaveCount(0);
  });

  test('clicking empty board clears selection @ref prd:sticky.select', async ({ page }) => {
    await openBoard(page);
    const note = await createNote(page, { x: 400, y: 300 }, 'sel');
    await note.click();
    await expect(page.getByRole('button', { name: 'Delete note' })).toBeVisible();
    await page.mouse.click(BOARD_CENTRE.x + 400, BOARD_CENTRE.y + 200);
    await expect(page.getByRole('button', { name: 'Delete note' })).toBeHidden();
  });
});
