import { expect, test, type Page } from '@playwright/test';
import {
  STICKY_COLORS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';
import { LONG_PARAGRAPH_1000, SHORT_PHRASE } from '../fixtures/texts';
import { drag, getCamera, openBoard, setCamera, viewport } from './helpers/board';
import {
  centre,
  createByDoubleClick,
  editor,
  noteId,
  noteIdAt,
  noteState,
  noteStates,
  notes,
} from './helpers/notes';

const PX_TOLERANCE = 1;
const WORLD_TOLERANCE = 1e-6;

function expectNear(actual: number, expected: number, tol = PX_TOLERANCE) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function fontPx(page: Page, id: string): Promise<number> {
  return page
    .locator(`[data-note-id="${id}"] [data-testid="sticky-text"]`)
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.describe('Workflow 1: brainstorm golden path', () => {
  test('TC-30 → TC-31 → colour → delete', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeVisible();
    await expect(notes(page)).toHaveCount(0);

    // TC-30: double-click at (400, 300), type immediately.
    const first = await createByDoubleClick(page, { x: 400, y: 300 });
    const firstId = await noteId(first);
    const c = await centre(first);
    expectNear(c.x, 400);
    expectNear(c.y, 300);
    const box = (await first.boundingBox())!;
    expectNear(box.width, STICKY_SIZE_WORLD);
    await expect(first).toHaveCSS('background-color', hexToRgb(STICKY_COLORS.yellow));
    await page.keyboard.type('Hello!');
    await page.keyboard.press('Backspace'); // edits text, never deletes the note
    await expect(editor(page)).toHaveValue('Hello');
    expect((await noteState(page, firstId)).text).toBe('Hello');

    // Click empty board: editing ends, text kept, not selected.
    await page.mouse.click(900, 650);
    await expect(editor(page)).toHaveCount(0);
    await expect(first).toHaveText('Hello');
    await expect(first).toHaveAttribute('data-selected', 'false');

    // A second note to keep.
    const second = await createByDoubleClick(page, { x: 900, y: 250 });
    const secondId = await noteId(second);
    await page.keyboard.type(SHORT_PHRASE);
    await page.keyboard.press('Escape');
    await expect(second).toHaveAttribute('data-selected', 'true');
    await expect(editor(page)).toHaveCount(0);

    // TC-31: at 50% zoom, drag the first note by (100, 50).
    const cam = await getCamera(page);
    await setCamera(page, { x: cam.x - 200, y: cam.y - 100, zoom: 0.5 });
    const firstNote = page.locator(`[data-note-id="${firstId}"]`);
    const before = (await firstNote.boundingBox())!;
    expectNear(before.width, STICKY_SIZE_WORLD * 0.5);
    const worldBefore = await noteState(page, firstId);
    const cameraBefore = await getCamera(page);
    const grab = { x: before.x + 30, y: before.y + 20 };
    await drag(page, grab, 100, 50);
    await expect(firstNote).toHaveAttribute('data-state', 'idle');
    const after = (await firstNote.boundingBox())!;
    expectNear(after.x, before.x + 100);
    expectNear(after.y, before.y + 50);
    const worldAfter = await noteState(page, firstId);
    expect(Math.abs(worldAfter.x - (worldBefore.x + 200))).toBeLessThan(WORLD_TOLERANCE);
    expect(Math.abs(worldAfter.y - (worldBefore.y + 100))).toBeLessThan(WORLD_TOLERANCE);
    expect(await getCamera(page)).toEqual(cameraBefore); // sticky.no_pan
    await expect(viewport(page)).toHaveAttribute('data-state', 'idle');

    // After the drag the note is selected and its toolbar is shown.
    await expect(firstNote).toHaveAttribute('data-selected', 'true');
    const green = page.getByRole('button', { name: 'Green colour' });
    await expect(green).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();
    // The note toolbar is not scaled with zoom and sits above the note.
    const tb = (await page.getByRole('toolbar', { name: 'Note' }).boundingBox())!;
    expect(tb.y + tb.height).toBeLessThanOrEqual(after.y);
    expect((await green.boundingBox())!.width).toBeGreaterThanOrEqual(20);

    await green.click();
    await expect(firstNote).toHaveCSS('background-color', hexToRgb(STICKY_COLORS.green));
    expect(await noteState(page, firstId)).toMatchObject({ color: 'green', text: 'Hello', x: worldAfter.x, y: worldAfter.y });
    await expect(firstNote).toHaveAttribute('data-selected', 'true');

    // Select the other note and delete it with the Delete key.
    const secondNote = page.locator(`[data-note-id="${secondId}"]`);
    const sc = await centre(secondNote);
    await page.mouse.click(sc.x, sc.y);
    await expect(secondNote).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    const remaining = await noteStates(page);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: firstId, color: 'green', text: 'Hello' });
  });

  test('bin button deletes, Enter edits the selected note', async ({ page }) => {
    await openBoard(page);
    const note = await createByDoubleClick(page, { x: 640, y: 400 });
    await page.keyboard.type('Retro');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type(' items');
    await page.keyboard.press('Escape');
    await expect(note).toHaveText('Retro items');
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(notes(page)).toHaveCount(0);
  });
});

test('TC-32 at 200% zoom the drag is exact and the dragged note is drawn on top', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 2 });
  const a = await createByDoubleClick(page, { x: 300, y: 400 });
  const aId = await noteId(a);
  await page.keyboard.press('Escape');
  const b = await createByDoubleClick(page, { x: 650, y: 400 });
  const bId = await noteId(b);
  await page.keyboard.press('Escape');

  const overlap = { x: 480, y: 400 };
  expect(await noteIdAt(page, overlap)).toBe(bId);

  const aNote = page.locator(`[data-note-id="${aId}"]`);
  const before = (await aNote.boundingBox())!;
  const worldBefore = await noteState(page, aId);
  const cameraBefore = await getCamera(page);
  await drag(page, { x: 200, y: 350 }, 100, 50);
  await expect(aNote).toHaveAttribute('data-state', 'idle');

  const after = (await aNote.boundingBox())!;
  expectNear(after.x, before.x + 100);
  expectNear(after.y, before.y + 50);
  const worldAfter = await noteState(page, aId);
  expect(Math.abs(worldAfter.x - (worldBefore.x + 50))).toBeLessThan(WORLD_TOLERANCE);
  expect(Math.abs(worldAfter.y - (worldBefore.y + 25))).toBeLessThan(WORLD_TOLERANCE);
  expect(worldAfter.z).toBeGreaterThan((await noteState(page, bId)).z);
  expect(await noteIdAt(page, { x: 560, y: 420 })).toBe(aId);
  expect(await getCamera(page)).toEqual(cameraBefore);
});

test('TC-33 text shrinks to fit, then clips with a fade at the minimum size', async ({ page }) => {
  await openBoard(page);
  const note = await createByDoubleClick(page, { x: 640, y: 400 });
  const id = await noteId(note);
  await page.keyboard.type('Onboarding');
  await page.keyboard.press('Escape');
  expect(await fontPx(page, id)).toBe(STICKY_FONT_MAX_PX);

  // A medium text is shrunk but still fits.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(LONG_PARAGRAPH_1000.slice(0, 180));
  await page.keyboard.press('Escape');
  const medium = await fontPx(page, id);
  expect(medium).toBeLessThan(STICKY_FONT_MAX_PX);
  expect(medium).toBeGreaterThan(STICKY_FONT_MIN_PX);
  const text = note.getByTestId('sticky-text');
  await expect(text).not.toHaveClass(/is-overflowing/);

  // Replace with 1,000 characters of prose.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(LONG_PARAGRAPH_1000);
  await expect(page.getByText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`)).toBeVisible();
  await page.keyboard.insertText('more');
  await expect(editor(page)).toHaveValue(LONG_PARAGRAPH_1000);
  await page.keyboard.press('Escape');

  expect((await noteState(page, id)).text).toBe(LONG_PARAGRAPH_1000);
  const small = await fontPx(page, id);
  expect(small).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(small).toBe(STICKY_FONT_MIN_PX);
  await expect(text).toHaveClass(/is-overflowing/);
  const clip = await text.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflow: getComputedStyle(el).overflow,
  }));
  expect(clip.scrollHeight).toBeGreaterThan(clip.clientHeight);
  expect(clip.overflow).toBe('hidden');
  const noteBox = (await note.boundingBox())!;
  const textBox = (await text.boundingBox())!;
  expect(textBox.x).toBeGreaterThanOrEqual(noteBox.x);
  expect(textBox.y).toBeGreaterThanOrEqual(noteBox.y);
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(noteBox.x + noteBox.width);
  expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height);
});

test('TC-34 the Sticky note button creates a note at the screen centre when panned far away', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(notes(page)).toHaveCount(1);
  const vp = page.viewportSize()!;
  const c = await centre(notes(page).first());
  expectNear(c.x, vp.width / 2);
  expectNear(c.y, vp.height / 2);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Far away idea');
  await expect(notes(page).first()).toContainText('Far away idea');
});
