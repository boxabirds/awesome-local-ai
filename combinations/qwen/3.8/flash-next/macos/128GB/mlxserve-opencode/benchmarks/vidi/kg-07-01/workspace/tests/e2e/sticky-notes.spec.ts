import { expect, test, type Page } from '@playwright/test';
import { openBoard, setCamera, settle } from './helpers/board';
import { centreOf, createByDoubleClick, dragBy, noteAt, noteBox, noteById, notes } from './helpers/notes';
import { LONG_TEXT, RETRO_ITEM, SHORT_TEXT, prose } from '../fixtures/texts';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';

const PX_TOLERANCE = 1;

function expectNear(actual: number, expected: number, tolerance = PX_TOLERANCE) {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
}

async function fontPx(page: Page, id: string) {
  return noteById(page, id)
    .locator('.sticky-note__text')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

async function noteData(page: Page, id: string) {
  return (await notes(page)).find((n) => n.id === id);
}

/** Moves the camera so world point `w` is at screen point `s`, at `zoom`. */
async function lookAt(page: Page, w: { x: number; y: number }, s: { x: number; y: number }, zoom: number) {
  await setCamera(page, { x: w.x - s.x / zoom, y: w.y - s.y / zoom, zoom });
  await settle(page);
}

test.describe('Workflow 1: brainstorm golden path', () => {
  test('TC-30 → TC-31 create by double-click, type, move at 50%, recolour, delete', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toHaveAttribute(
      'title',
      'Sticky note – or double-click the board',
    );

    // TC-30: double-click at (400, 300), type straight away.
    const id = await createByDoubleClick(page, { x: 400, y: 300 });
    await page.keyboard.type('Hello');
    const centre = await centreOf(page, id);
    expectNear(centre.x, 400);
    expectNear(centre.y, 300);
    const box = await noteBox(page, id);
    expectNear(box.width, STICKY_SIZE_WORLD);
    let n = await noteData(page, id);
    expect(n).toMatchObject({ text: 'Hello', color: 'yellow' });
    expect(await noteById(page, id).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 245, 157)');

    // Clicking empty board ends editing and deselects; the text stays.
    await page.mouse.click(900, 600);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'false');
    await expect(noteById(page, id)).toHaveText('Hello');

    // A second note, created with the toolbar button, which should survive the workflow.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.type(SHORT_TEXT);
    await page.keyboard.press('Escape');
    const keep = (await notes(page)).find((x) => x.text === SHORT_TEXT)!;
    expect(keep).toBeDefined();

    // TC-31: at 50% zoom, drag the first note by (100, 50) screen px.
    n = (await noteData(page, id))!;
    await lookAt(page, { x: n.x + STICKY_SIZE_WORLD / 2, y: n.y + STICKY_SIZE_WORLD / 2 }, { x: 300, y: 300 }, 0.5);
    const before = await noteBox(page, id);
    expectNear(before.width, STICKY_SIZE_WORLD * 0.5);
    const grab = { x: before.x + 20, y: before.y + 30 };
    await dragBy(page, grab, 100, 50);
    const after = await noteBox(page, id);
    expectNear(after.x + 20, grab.x + 100);
    expectNear(after.y + 30, grab.y + 50);
    const moved = (await noteData(page, id))!;
    expect(moved.x).toBeCloseTo(n.x + 200, 6);
    expect(moved.y).toBeCloseTo(n.y + 100, 6);
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'true');

    // Recolour via the note toolbar.
    const toolbar = page.getByRole('toolbar', { name: 'Note' });
    await expect(toolbar).toBeVisible();
    await page.getByRole('button', { name: 'Green colour' }).click();
    expect((await noteData(page, id))!.color).toBe('green');
    await expect(page.getByRole('button', { name: 'Green colour' })).toHaveAttribute('aria-pressed', 'true');
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'true');
    expect(await noteById(page, id).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(197, 225, 165)');
    expect(STICKY_COLORS.green).toBe('#C5E1A5');

    // Delete it with the keyboard.
    await page.keyboard.press('Delete');
    await expect(noteById(page, id)).toHaveCount(0);
    const remaining = await notes(page);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: keep.id, text: SHORT_TEXT, color: 'yellow', x: keep.x, y: keep.y });
  });

  test('double-click on a note edits it; Enter edits a selected note; Backspace while editing edits text', async ({ page }) => {
    await openBoard(page);
    const id = await createByDoubleClick(page, { x: 500, y: 400 });
    await page.keyboard.type('Retro');
    await page.keyboard.press('Escape');
    await expect(noteById(page, id)).toHaveAttribute('data-selected', 'true');

    await page.mouse.dblclick(500, 400);
    expect(await notes(page)).toHaveLength(1);
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    expect((await noteData(page, id))!.text).toBe('Retr');

    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await page.keyboard.type('o');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');
    expect((await noteData(page, id))!.text).toBe('Retro\nWent well');

    await page.keyboard.press('Backspace');
    await expect(noteById(page, id)).toHaveCount(0);
  });

  test('dragging a note never pans the board', async ({ page }) => {
    await openBoard(page);
    const a = await createByDoubleClick(page, { x: 300, y: 300 });
    await page.keyboard.press('Escape');
    const b = await createByDoubleClick(page, { x: 800, y: 500 });
    await page.keyboard.press('Escape');
    const bBefore = await noteBox(page, b);
    const origin = await page.getByTestId('origin-marker').boundingBox();
    await dragBy(page, { x: 300, y: 300 }, 150, -80);
    expect(await noteBox(page, b)).toEqual(bBefore);
    expect(await page.getByTestId('origin-marker').boundingBox()).toEqual(origin);
    const aCentre = await centreOf(page, a);
    expectNear(aCentre.x, 450);
    expectNear(aCentre.y, 220);
  });
});

test('TC-32 at 200% a drag moves by half the screen distance and brings the note to the front', async ({ page }) => {
  await openBoard(page);
  // Two overlapping notes; the second (created later) is on top.
  const lower = await createByDoubleClick(page, { x: 300, y: 300 });
  await page.keyboard.type(RETRO_ITEM);
  await page.keyboard.press('Escape');
  const upper = await createByDoubleClick(page, { x: 450, y: 350 });
  await page.keyboard.press('Escape');

  const n = (await noteData(page, lower))!;
  await lookAt(page, { x: n.x, y: n.y }, { x: 200, y: 150 }, 2);
  const before = await noteBox(page, lower);
  expectNear(before.width, STICKY_SIZE_WORLD * 2);
  const upperBox = await noteBox(page, upper);
  // A point inside both notes: the upper one is drawn there.
  const overlapBefore = { x: upperBox.x + 20, y: upperBox.y + 150 };
  expect(await noteAt(page, overlapBefore)).toBe(upper);

  const grab = { x: before.x + 40, y: before.y + 40 };
  await dragBy(page, grab, 100, 50);
  const moved = (await noteData(page, lower))!;
  expect(moved.x).toBeCloseTo(n.x + 50, 6);
  expect(moved.y).toBeCloseTo(n.y + 25, 6);
  const after = await noteBox(page, lower);
  expectNear(after.x + 40, grab.x + 100);
  expectNear(after.y + 40, grab.y + 50);

  // Still overlapping; now the dragged note is drawn on top.
  const overlapAfter = { x: upperBox.x + 20, y: upperBox.y + 150 };
  expect(overlapAfter.x).toBeLessThan(after.x + after.width);
  expect(await noteAt(page, overlapAfter)).toBe(lower);
  expect(moved.z).toBeGreaterThan((await noteData(page, upper))!.z);
});

test.describe('Workflow 3: long text', () => {
  test('TC-33 one word is large; 1,000 characters shrink to the minimum and clip with a fade', async ({ page }) => {
    await openBoard(page);
    const id = await createByDoubleClick(page, { x: 640, y: 400 });
    await page.keyboard.type('Onboarding');
    await settle(page);
    expect(await fontPx(page, id)).toBe(STICKY_FONT_MAX_PX);
    await expect(noteById(page, id)).toHaveAttribute('data-overflow', 'false');

    // A three-line retro item still fits, at a size between the extremes.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(RETRO_ITEM);
    await settle(page);
    const mid = await fontPx(page, id);
    expect(mid).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(mid).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    await expect(noteById(page, id)).toHaveAttribute('data-overflow', 'false');

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(LONG_TEXT);
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await noteData(page, id))!.text).toBe(LONG_TEXT);
    const small = await fontPx(page, id);
    expect(small).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(small).toBeLessThan(mid);
    await expect(noteById(page, id)).toHaveClass(/sticky-note--overflow/);
    await expect(noteById(page, id)).toHaveAttribute('data-overflow', 'true');

    // Clipped: the content is taller than the note, but nothing is drawn outside the note box.
    const text = noteById(page, id).locator('.sticky-note__text');
    const { scrollHeight, clientHeight, overflow } = await text.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflow: getComputedStyle(el).overflow,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);
    expect(overflow).toBe('hidden');
    const noteB = await noteBox(page, id);
    const textB = (await text.boundingBox())!;
    expectNear(textB.y + textB.height, noteB.y + noteB.height);
    expectNear(textB.x + textB.width, noteB.x + noteB.width);
    const fade = await noteById(page, id).evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
    expect(fade).toContain('gradient');
  });

  test('pasting 1,200 characters keeps exactly the first 1,000 and shows 1000/1000', async ({ page }) => {
    await openBoard(page);
    const id = await createByDoubleClick(page, { x: 640, y: 400 });
    const pasted = prose(1200);
    await page.keyboard.insertText(pasted);
    await expect(page.getByTestId('note-counter')).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
    expect((await noteData(page, id))!.text).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    // Further typing is not added.
    await page.keyboard.type('x');
    expect((await noteData(page, id))!.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    // Deleting brings it under the threshold: the counter goes away.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(SHORT_TEXT);
    await expect(page.getByTestId('note-counter')).toHaveCount(0);
  });
});

test.describe('Workflow 2: create while far away', () => {
  test('TC-34 the Sticky note button puts the note in the middle of the screen', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 750_000, y: -420_000, zoom: 1 });
    await settle(page);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    const all = await notes(page);
    expect(all).toHaveLength(1);
    await expect(noteById(page, all[0].id)).toBeInViewport();
    const viewport = page.viewportSize()!;
    const c = await centreOf(page, all[0].id);
    expectNear(c.x, viewport.width / 2);
    expectNear(c.y, viewport.height / 2);
    await expect(page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await page.keyboard.type(SHORT_TEXT);
    expect((await notes(page))[0].text).toBe(SHORT_TEXT);
  });
});
