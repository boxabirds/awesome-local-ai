import { type Locator, type Page, expect, test } from '@playwright/test';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config';
import { PROSE_1000, SHORT_PHRASE, prose } from '../fixtures/texts';
import { getCamera, nextFrames, openBoard, setCamera } from './helpers/board';

const TOLERANCE_PX = 1;
const VIEWPORT_CENTRE = { x: 640, y: 400 };

async function getNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => [...(window.__vidi6?.getNotes?.() ?? [])]);
}

function notes(page: Page): Locator {
  return page.getByRole('group', { name: 'Sticky note' });
}

function noteById(page: Page, id: string): Locator {
  return page.locator(`[data-sticky-note][data-id="${id}"]`);
}

async function centreOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

function expectNear(actual: { x: number; y: number }, expected: { x: number; y: number }, tolerance = TOLERANCE_PX) {
  expect(Math.abs(actual.x - expected.x), `x ${actual.x} vs ${expected.x}`).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y), `y ${actual.y} vs ${expected.y}`).toBeLessThanOrEqual(tolerance);
}

/** Creates a note by double-clicking empty board space and types into it. */
async function createByDoubleClick(page: Page, at: { x: number; y: number }, text: string): Promise<StickySnapshot> {
  const before = new Set((await getNotes(page)).map((n) => n.id));
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByRole('textbox', { name: 'Sticky note text' })).toBeFocused();
  await page.keyboard.type(text);
  const created = (await getNotes(page)).find((n) => !before.has(n.id));
  if (!created) throw new Error('no note created');
  expect(created.text).toBe(text);
  return created;
}

/** Clicks empty board space (ends editing, clears the selection). */
async function clickEmpty(page: Page, at = { x: 1200, y: 60 }) {
  await page.mouse.click(at.x, at.y);
  await nextFrames(page);
}

async function note(page: Page, id: string): Promise<StickySnapshot> {
  const found = (await getNotes(page)).find((n) => n.id === id);
  if (!found) throw new Error(`note ${id} missing`);
  return found;
}

/** Camera at `zoom` that shows world point `world` at screen point `screen`. */
function cameraShowing(world: { x: number; y: number }, screen: { x: number; y: number }, zoom: number) {
  return { x: world.x - screen.x / zoom, y: world.y - screen.y / zoom, zoom };
}

function worldCentre(n: StickySnapshot) {
  return { x: n.x + STICKY_SIZE_WORLD / 2, y: n.y + STICKY_SIZE_WORLD / 2 };
}

/** The note drawn on top at a screen point. */
async function topNoteIdAt(page: Page, p: { x: number; y: number }) {
  return page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-sticky-note]') as HTMLElement | null)?.dataset.id ?? null,
    p,
  );
}

test.describe('story 2: sticky notes', () => {
  test('workflow 1: brainstorm golden path (TC-30, TC-31, colour, delete)', async ({ page }) => {
    await openBoard(page);
    await expect(page.getByRole('button', { name: 'Sticky note' })).toHaveAttribute(
      'title',
      'Sticky note (N) – or double-click the board',
    );

    // TC-30: double-click at (400, 300) and type straight away.
    const created = await createByDoubleClick(page, { x: 400, y: 300 }, 'Hello');
    const el = noteById(page, created.id);
    expect(created.color).toBe('yellow');
    expectNear(await centreOf(el), { x: 400, y: 300 });
    await expect(el).toContainText('Hello');
    await expect(el).toHaveCSS('background-color', 'rgb(255, 245, 157)');

    // Clicking empty board ends editing and deselects; the text stays.
    await clickEmpty(page);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(el).toHaveAttribute('data-selected', 'false');
    await expect(el).toContainText('Hello');

    // Click selects: outline + note toolbar.
    await el.click();
    await expect(el).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('toolbar', { name: 'Note' })).toBeVisible();

    // TC-31: at 50% zoom, drag by (100, 50); the grabbed point stays under the pointer.
    await setCamera(page, cameraShowing(worldCentre(created), { x: 400, y: 300 }, 0.5));
    const start = await centreOf(el);
    expectNear(start, { x: 400, y: 300 });
    const grab = { x: start.x + 20, y: start.y + 10 };
    const cameraBefore = await getCamera(page);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 50, grab.y + 25, { steps: 5 });
    await nextFrames(page);
    expectNear(await centreOf(el), { x: start.x + 50, y: start.y + 25 });
    await expect(page.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
    await page.mouse.move(grab.x + 100, grab.y + 50, { steps: 5 });
    await page.mouse.up();
    await nextFrames(page);
    expectNear(await centreOf(el), { x: start.x + 100, y: start.y + 50 });
    const moved = await note(page, created.id);
    expect(moved.x - created.x).toBeCloseTo(200, 6);
    expect(moved.y - created.y).toBeCloseTo(100, 6);
    // sticky.no_pan: the board did not move.
    expect(await getCamera(page)).toEqual(cameraBefore);

    // Recolour with the green swatch; text, position and selection unchanged.
    await expect(el).toHaveAttribute('data-selected', 'true');
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect(el).toHaveAttribute('data-color', 'green');
    await expect(el).toHaveCSS('background-color', 'rgb(197, 225, 165)');
    await expect(el).toHaveAttribute('data-selected', 'true');
    expect(await note(page, created.id)).toEqual({ ...moved, color: 'green' });

    // A duplicate note, selected and removed with Delete.
    const duplicate = await createByDoubleClick(page, { x: 900, y: 550 }, SHORT_PHRASE);
    await clickEmpty(page);
    await noteById(page, duplicate.id).click();
    await expect(noteById(page, duplicate.id)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(noteById(page, duplicate.id)).toHaveCount(0);

    const remaining = await getNotes(page);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ id: created.id, text: 'Hello', color: 'green', x: moved.x, y: moved.y });
    await expect(notes(page)).toHaveCount(1);
  });

  test('Backspace while typing edits text; Enter edits the selected note; bin deletes', async ({ page }) => {
    await openBoard(page);
    const created = await createByDoubleClick(page, { x: 640, y: 400 }, 'Typo!');
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await note(page, created.id)).text).toBe('Typo');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(noteById(page, created.id)).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Enter');
    await page.keyboard.type(' fixed');
    await expect.poll(async () => (await note(page, created.id)).text).toBe('Typo fixed');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(notes(page)).toHaveCount(0);
  });

  test('TC-32: drag at 200% zoom moves by delta / zoom and draws the note on top', async ({ page }) => {
    await openBoard(page);
    const a = await createByDoubleClick(page, { x: 400, y: 300 }, 'Idea A');
    const b = await createByDoubleClick(page, { x: 560, y: 300 }, 'Idea B');
    await clickEmpty(page);
    expect(b.z).toBeGreaterThan(a.z);

    await setCamera(page, cameraShowing(worldCentre(a), { x: 300, y: 400 }, 2));
    // A spans x 100..500 and B spans x 420..820 on screen: B covers A where they overlap.
    expect(await topNoteIdAt(page, { x: 460, y: 400 })).toBe(b.id);

    const elA = noteById(page, a.id);
    const start = await centreOf(elA);
    const grab = { x: 200, y: 400 };
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 100, grab.y + 50, { steps: 8 });
    await nextFrames(page);
    // Drawn above B while dragging.
    expect(await topNoteIdAt(page, { x: 500, y: 450 })).toBe(a.id);
    await page.mouse.up();
    await nextFrames(page);

    expectNear(await centreOf(elA), { x: start.x + 100, y: start.y + 50 });
    const moved = await note(page, a.id);
    expect(moved.x - a.x).toBeCloseTo(50, 6);
    expect(moved.y - a.y).toBeCloseTo(25, 6);
    expect(moved.z).toBeGreaterThan((await note(page, b.id)).z);
    expect(await topNoteIdAt(page, { x: 500, y: 450 })).toBe(a.id);
  });

  test('TC-33: text shrinks to fit, then clips with a fade at the minimum size', async ({ page }) => {
    await openBoard(page);
    const created = await createByDoubleClick(page, { x: 640, y: 400 }, 'Brainstorm');
    const el = noteById(page, created.id);
    const text = el.getByTestId('sticky-text');
    await expect(text).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
    await expect(page.getByRole('textbox')).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
    await expect(el).not.toHaveClass(/sticky-note--overflow/);

    // A medium text shrinks but still fits.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(prose(160));
    await expect.poll(async () => parseFloat(await text.evaluate((e) => getComputedStyle(e).fontSize))).toBeLessThan(
      STICKY_FONT_MAX_PX,
    );
    await expect(el).not.toHaveClass(/sticky-note--overflow/);

    // Paste a 1,000 character paragraph (replacing the text), then try to paste more.
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(PROSE_1000);
    await expect(page.getByText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`)).toBeVisible();
    await page.keyboard.insertText(' and more text that does not fit');
    await expect.poll(async () => (await note(page, created.id)).text).toBe(PROSE_1000);
    await page.keyboard.press('Escape');

    await expect(el).toHaveClass(/sticky-note--overflow/);
    const fontPx = parseFloat(await text.evaluate((e) => getComputedStyle(e).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontPx).toBe(STICKY_FONT_MIN_PX);
    const metrics = await text.evaluate((e) => ({ scrollHeight: e.scrollHeight, clientHeight: e.clientHeight }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    // Nothing is drawn outside the note.
    const noteBox = (await el.boundingBox())!;
    const textBox = (await text.boundingBox())!;
    expect(textBox.y).toBeGreaterThanOrEqual(noteBox.y);
    expect(textBox.y + textBox.height).toBeLessThanOrEqual(noteBox.y + noteBox.height + 0.5);
    expect(await el.evaluate((e) => getComputedStyle(e).overflow)).toBe('hidden');
    const fade = await el.evaluate((e) => getComputedStyle(e, '::after').backgroundImage);
    expect(fade).toContain('gradient');
  });

  test('TC-34: the Sticky note button creates a note in the middle of the screen far from the origin', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: UNBOUNDED_PAN_TESTED_EXTENT, y: -UNBOUNDED_PAN_TESTED_EXTENT, zoom: 1 });
    await page.getByRole('button', { name: 'Sticky note' }).click();
    const textbox = page.getByRole('textbox', { name: 'Sticky note text' });
    await expect(textbox).toBeFocused();
    await page.keyboard.type(SHORT_PHRASE);
    const [created] = await getNotes(page);
    expect(created.text).toBe(SHORT_PHRASE);
    const el = noteById(page, created.id);
    await expect(el).toBeInViewport();
    expectNear(await centreOf(el), VIEWPORT_CENTRE);
  });
});
