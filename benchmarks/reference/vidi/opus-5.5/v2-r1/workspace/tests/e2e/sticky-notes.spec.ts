import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_PROSE_1000, SHORT_TEXT, prose } from '../fixtures/texts';
import {
  boxOf,
  centreOf,
  drag,
  getCamera,
  getNotes,
  noteEditor,
  noteIdAt,
  notes,
  openBoard,
  setCamera,
  waitForFrame,
} from './helpers/board';

const TOLERANCE_PX = 1;
const VIEW = { width: 1280, height: 800 };
/** Empty board space away from toolbars, hint and zoom controls. */
const EMPTY_SPOT = { x: 1100, y: 150 };

function expectNear(actual: number, expected: number, tol = TOLERANCE_PX) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/** Camera that shows world point `w` at the centre of the screen. */
function cameraCentredOn(w: { x: number; y: number }, zoom: number) {
  return { x: w.x - VIEW.width / 2 / zoom, y: w.y - VIEW.height / 2 / zoom, zoom };
}

test.describe('Workflow 1: brainstorm golden path', () => {
  test('TC-30 → TC-31 → colour → delete', async ({ page }) => {
    await openBoard(page);

    // TC-30: double-click empty space; a yellow note is centred there and accepts typing.
    await page.mouse.dblclick(400, 300);
    await expect(notes(page)).toHaveCount(1);
    await expect(noteEditor(page)).toBeFocused();
    await page.keyboard.type('Hello');
    const note = notes(page).first();
    const created = centreOf(await boxOf(note));
    expectNear(created.x, 400);
    expectNear(created.y, 300);
    let [model] = await getNotes(page);
    expect(model).toMatchObject({ text: 'Hello', color: 'yellow' });
    await expect(note).toHaveCSS('background-color', 'rgb(255, 245, 157)');

    // Clicking empty board ends editing and deselects; the text stays.
    await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expect(noteEditor(page)).toHaveCount(0);
    await expect(note).toHaveAttribute('data-selected', 'false');
    await expect(note).toContainText('Hello');

    // A second note, created from the toolbar, to be the duplicate deleted later.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.type(SHORT_TEXT);
    await page.keyboard.press('Escape');
    await expect(notes(page)).toHaveCount(2);
    await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);

    // TC-31: at 50% zoom a drag keeps the grabbed point under the pointer.
    const helloId = model.id;
    const hello = page.locator(`[data-sticky-id="${helloId}"]`);
    await setCamera(page, cameraCentredOn({ x: model.x - 300, y: model.y - 200 }, 0.5));
    await waitForFrame(page);
    const before = await boxOf(hello);
    expectNear(before.width, STICKY_SIZE_WORLD * 0.5);
    const grab = { x: before.x + 20, y: before.y + 30 };
    const gridBefore = await getCamera(page);
    await drag(page, grab, 100, 50);
    const after = await boxOf(hello);
    expectNear(after.x + 20, grab.x + 100);
    expectNear(after.y + 30, grab.y + 50);
    expect(await getCamera(page)).toEqual(gridBefore);
    const moved = (await getNotes(page)).find((n) => n.id === helloId)!;
    expectNear(moved.x - model.x, 200, 0.01);
    expectNear(moved.y - model.y, 100, 0.01);
    await expect(hello).toHaveAttribute('data-selected', 'true');
    model = moved;

    // Recolour via the swatch: only the colour changes.
    await expect(page.getByRole('toolbar', { name: 'Note toolbar' })).toBeVisible();
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect(hello).toHaveCSS('background-color', 'rgb(197, 225, 165)');
    const green = (await getNotes(page)).find((n) => n.id === helloId)!;
    expect(green).toEqual({ ...model, color: 'green' });
    await expect(hello).toHaveAttribute('data-selected', 'true');

    // Delete the duplicate with the Delete key.
    await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await setCamera(page, cameraCentredOn({ x: 0, y: 0 }, 1));
    await waitForFrame(page);
    const duplicate = page.locator('[data-sticky-id]').filter({ hasText: SHORT_TEXT });
    const dupBox = await boxOf(duplicate);
    // The moved "Hello" note (now on top) covers the duplicate's top-left corner.
    await page.mouse.click(dupBox.x + dupBox.width - 10, dupBox.y + dupBox.height - 10);
    await expect(duplicate).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    const remaining = await getNotes(page);
    expect(remaining).toEqual([green]);
  });

  test('Backspace while editing edits text; Backspace on a selected note deletes it', async ({
    page,
  }) => {
    await openBoard(page);
    await page.mouse.dblclick(500, 400);
    await page.keyboard.type('ab');
    await page.keyboard.press('Backspace');
    await expect(notes(page)).toHaveCount(1);
    expect((await getNotes(page))[0].text).toBe('a');
    await page.keyboard.press('Escape');
    await expect(noteEditor(page)).toHaveCount(0);
    // Enter edits again with the caret at the end.
    await page.keyboard.press('Enter');
    await expect(noteEditor(page)).toBeFocused();
    await page.keyboard.type('bc');
    expect((await getNotes(page))[0].text).toBe('abc');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await expect(notes(page)).toHaveCount(0);
  });
});

test('TC-32 at 200% zoom a dragged note moves by delta/zoom and is drawn above the note it overlaps', async ({
  page,
}) => {
  await openBoard(page);
  // A: centred on world (0, 0). B: centred on world (120, 120), created later so it is on top.
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.keyboard.type('A');
  await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
  await page.mouse.dblclick(VIEW.width / 2 + 120, VIEW.height / 2 + 120);
  await page.keyboard.type('B');
  await page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
  const [a, b] = await getNotes(page);
  expect(a.text).toBe('A');
  expect(b.text).toBe('B');

  await setCamera(page, cameraCentredOn({ x: 60, y: 60 }, 2));
  await waitForFrame(page);
  // World (100, 100) is inside both notes after the drag; B is on top before it.
  const overlap = { x: (100 - 60) * 2 + VIEW.width / 2, y: (100 - 60) * 2 + VIEW.height / 2 };
  expect(await noteIdAt(page, overlap.x, overlap.y)).toBe(b.id);

  const aBox = await boxOf(page.locator(`[data-sticky-id="${a.id}"]`));
  const grab = { x: aBox.x + 60, y: aBox.y + 60 };
  const camera = await getCamera(page);
  await drag(page, grab, 100, 50);
  const moved = (await getNotes(page)).find((n) => n.id === a.id)!;
  expectNear(moved.x - a.x, 50, 0.01);
  expectNear(moved.y - a.y, 25, 0.01);
  const after = await boxOf(page.locator(`[data-sticky-id="${a.id}"]`));
  expectNear(after.x + 60, grab.x + 100);
  expectNear(after.y + 60, grab.y + 50);
  expect(await getCamera(page)).toEqual(camera);
  expect(await noteIdAt(page, overlap.x, overlap.y)).toBe(a.id);
});

test('TC-33 text shrinks to fit, then clips with a fade at the minimum size', async ({ page }) => {
  await openBoard(page);
  await page.mouse.dblclick(640, 400);
  await page.keyboard.type('Brainstorm');
  const editorEl = noteEditor(page);
  await expect(editorEl).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await page.keyboard.press('Escape');
  const note = notes(page).first();
  const text = note.locator('.sticky-text');
  await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
  await expect(note).not.toHaveClass(/is-overflowing/);

  // Paste 1,200 characters: the first 1,000 are kept and the counter shows 1000/1000.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+A');
  const pasted = prose(1200);
  await page.keyboard.insertText(pasted);
  await expect(note.locator('.sticky-counter')).toHaveText(
    `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
  );
  expect((await getNotes(page))[0].text).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));

  // The 1,000-character prose fixture at the minimum size overflows: clipped with a fade.
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(LONG_PROSE_1000);
  await page.keyboard.press('Escape');
  await expect(note).toHaveClass(/is-overflowing/);
  const fontPx = parseFloat(await text.evaluate((el) => getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
  const clip = await note.locator('.sticky-body').evaluate((el) => ({
    overflow: getComputedStyle(el).overflow,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    fade: getComputedStyle(el, '::after').content,
  }));
  expect(clip.overflow).toBe('hidden');
  expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
  expect(clip.fade).not.toBe('none');
  // Nothing is drawn outside the note box.
  const noteBox = await boxOf(note);
  const bodyBox = await boxOf(note.locator('.sticky-body'));
  expectNear(bodyBox.x, noteBox.x);
  expectNear(bodyBox.y, noteBox.y);
  expectNear(bodyBox.width, noteBox.width);
  expectNear(bodyBox.height, noteBox.height);
});

test('TC-34 the Sticky note button creates a note at the screen centre when panned far away', async ({
  page,
}) => {
  await openBoard(page);
  await setCamera(page, { x: 987_654, y: -543_210, zoom: 1 });
  await waitForFrame(page);
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(notes(page)).toHaveCount(1);
  const centre = centreOf(await boxOf(notes(page).first()));
  expectNear(centre.x, VIEW.width / 2);
  expectNear(centre.y, VIEW.height / 2);
  await expect(noteEditor(page)).toBeFocused();
  await page.keyboard.type('Far away idea');
  expect((await getNotes(page))[0].text).toBe('Far away idea');
});
