// Story 7 — Select, move, resize and delete several objects at once.
import { test, expect, requires, openBoard, notes, createNote, clickEmpty, box, drag, shot, mod } from './fixtures';

const PIXEL_TOLERANCE = 1.5;
const NUDGE_SMALL = 1;
const NUDGE_LARGE = 10;
const STICKY_MIN_WORLD = 50;
const SIZE_TOLERANCE = 2;
const NUDGE_TOLERANCE = 0.6;
// Design names handles 'n'|'ne'|…|'se'; accept a spelled-out position too.
const SE_HANDLE = '[aria-label="Resize se" i], [aria-label*="bottom-right" i], [aria-label*="bottom right" i], [aria-label*="south-east" i]';

test.describe('story 7 @s07', () => {
  test.beforeEach(() => requires(7));

  test('golden path: marquee selects enclosed notes, bar shows count @ref prd:sel.marquee prd:sel.bar', async ({ page }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    const a = await createNote(page, { x: 350, y: 300 }, 'A');
    const b = await createNote(page, { x: 550, y: 300 }, 'B');
    const c = await createNote(page, { x: 950, y: 300 }, 'C');
    const ab = await box(a), bb = await box(b);
    await clickEmpty(page, { x: 1100, y: 650 });
    await drag(page, { x: ab.x - 20, y: ab.y - 20 }, { x: bb.x + bb.width + 20, y: bb.y + bb.height + 20 }, { shift: true });
    await expect(page.getByText('2 selected').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible();
    await expect(page.locator('[aria-label^="Resize "]')).toHaveCount(8);
    await shot(page, 's07-golden');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(c).toHaveCount(1);
  });

  test('partly enclosed note is not selected @ref prd:sel.marquee', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 300, y: 300 }, 'full');
    const b = await createNote(page, { x: 600, y: 300 }, 'half');
    const ab = await box(a), bb = await box(b);
    await drag(page, { x: ab.x - 20, y: ab.y - 20 }, { x: bb.x + bb.width / 2, y: bb.y + bb.height + 20 }, { shift: true });
    await expect(page.getByRole('button', { name: 'Delete note' })).toBeVisible(); // exactly one sticky selected
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page).first()).toContainText('half');
  });

  test('shift-click toggles membership @ref prd:sel.shift_toggle', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 300, y: 300 }, 'a1');
    const b = await createNote(page, { x: 600, y: 300 }, 'b1');
    const c = await createNote(page, { x: 900, y: 300 }, 'c1');
    await a.click();
    await b.click({ modifiers: ['Shift'] });
    await c.click({ modifiers: ['Shift'] });
    await expect(page.getByText('3 selected').first()).toBeVisible();
    await b.click({ modifiers: ['Shift'] });
    await expect(page.getByText('2 selected').first()).toBeVisible();
  });

  test('select all, escape clears, delete removes all @ref prd:sel.all prd:sel.clear prd:sel.group_delete', async ({ page }) => {
    await openBoard(page);
    for (let i = 0; i < 3; i++) await createNote(page, { x: 300 + i * 250, y: 300 }, `all${i}`);
    await clickEmpty(page);
    await page.keyboard.press(`${mod}+KeyA`);
    await expect(page.getByText('3 selected').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Delete selection' })).toBeHidden();
    await page.keyboard.press(`${mod}+KeyA`);
    await page.getByRole('button', { name: 'Delete selection' }).click();
    await expect(notes(page)).toHaveCount(0);
  });

  test('dragging one selected note moves the whole selection @ref prd:sel.group_move', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 300, y: 300 }, 'g1');
    const b = await createNote(page, { x: 600, y: 300 }, 'g2');
    await a.click();
    await b.click({ modifiers: ['Shift'] });
    const a0 = await box(a), b0 = await box(b);
    await drag(page, { x: a0.x + 30, y: a0.y + 30 }, { x: a0.x + 130, y: a0.y + 230 });
    const a1 = await box(a), b1 = await box(b);
    for (const [before, after] of [[a0, a1], [b0, b1]]) {
      expect(Math.abs(after.x - before.x - 100)).toBeLessThan(PIXEL_TOLERANCE);
      expect(Math.abs(after.y - before.y - 200)).toBeLessThan(PIXEL_TOLERANCE);
    }
  });

  test('dragging an unselected note moves only it @ref prd:sel.drag_unselected', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 300, y: 300 }, 'u1');
    const b = await createNote(page, { x: 600, y: 300 }, 'u2');
    await a.click();
    const a0 = await box(a), b0 = await box(b);
    await drag(page, { x: b0.x + 30, y: b0.y + 30 }, { x: b0.x + 130, y: b0.y + 30 });
    expect(Math.abs((await box(a)).x - a0.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs((await box(b)).x - b0.x - 100)).toBeLessThan(PIXEL_TOLERANCE);
  });

  test('arrow keys nudge 1, shift+arrow 10, board does not pan @ref prd:sel.nudge', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 400, y: 300 }, 'nudge');
    const other = await createNote(page, { x: 800, y: 300 }, 'fixed');
    await a.click();
    const a0 = await box(a), o0 = await box(other);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const a1 = await box(a);
    expect(Math.abs(a1.x - a0.x - NUDGE_SMALL)).toBeLessThan(NUDGE_TOLERANCE);
    expect(Math.abs(a1.y - a0.y - NUDGE_LARGE)).toBeLessThan(NUDGE_TOLERANCE);
    expect(Math.abs((await box(other)).x - o0.x)).toBeLessThan(NUDGE_TOLERANCE);
  });

  test('corner resize keeps sticky square; minimum size enforced @ref prd:sel.resize prd:sel.aspect prd:sel.size_limits', async ({ page }) => {
    await openBoard(page);
    const a = await createNote(page, { x: 400, y: 350 }, 'grow');
    await a.click();
    const handle = page.locator(SE_HANDLE).first();
    const h = await box(handle);
    const a0 = await box(a);
    await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: h.x + 200, y: h.y + 50 });
    const a1 = await box(a);
    expect(Math.abs(a1.width - a1.height)).toBeLessThan(SIZE_TOLERANCE);
    expect(a1.width).toBeGreaterThan(a0.width + 40);
    expect(Math.abs(a1.x - a0.x)).toBeLessThan(PIXEL_TOLERANCE);
    const h2 = await box(handle);
    await drag(page, { x: h2.x + h2.width / 2, y: h2.y + h2.height / 2 }, { x: a1.x - 300, y: a1.y - 300 });
    const a2 = await box(a);
    expect(a2.width).toBeGreaterThanOrEqual(STICKY_MIN_WORLD - SIZE_TOLERANCE);
  });
});
