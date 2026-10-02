import { test, expect, type Page } from '@playwright/test';
import { screenToWorld, worldToScreen, type Camera } from '../../src/client/canvas/camera';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_SIZE_WORLD,
  STICKY_FONT_MIN_PX,
  STICKY_FONT_MAX_PX,
} from '../../src/shared/config';
import { PROSE_1000 } from '../fixtures/texts';

const VIEWPORT = { width: 1280, height: 800 };

const notes = (page: Page): Promise<readonly StickySnapshot[]> =>
  page.evaluate(() => window.__vidi6?.getObjects() ?? []);

const camera = (page: Page): Promise<Camera> =>
  page.evaluate(() => window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 });

async function setCamera(page: Page, next: Camera): Promise<void> {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), next);
  // React applies the camera asynchronously; wait for it before measuring.
  await expect.poll(() => camera(page)).toEqual(next);
}

const noteLocator = (page: Page, id: string) =>
  page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`);

async function boxOf(page: Page, id: string) {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no screen box`);
  return box;
}

async function noteById(page: Page, id: string): Promise<StickySnapshot> {
  const note = (await notes(page)).find((n) => n.id === id);
  if (!note) throw new Error(`note ${id} is gone`);
  return note;
}

/** Where the note should be on screen according to the document and camera. */
function expectedBox(note: StickySnapshot, cam: Camera) {
  const p = worldToScreen(cam, { x: note.x, y: note.y });
  const size = STICKY_SIZE_WORLD * cam.zoom;
  return { x: p.x, y: p.y, width: size, height: size };
}

/**
 * Wait until the painted note box matches the document and camera, then return
 * the painted box. Keeps assertions free of arbitrary timeouts.
 */
async function settleBox(page: Page, id: string) {
  await expect
    .poll(async () => {
      const note = await noteById(page, id);
      const expected = expectedBox(note, await camera(page));
      const box = await boxOf(page, id);
      return Math.abs(box.x - expected.x) + Math.abs(box.y - expected.y);
    })
    .toBeLessThanOrEqual(1);
  return boxOf(page, id);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function createdNote(page: Page, before: number): Promise<StickySnapshot> {
  await expect.poll(() => notes(page).then((all) => all.length)).toBe(before + 1);
  const all = await notes(page);
  return all[all.length - 1]!;
}

const noteIdUnderPoint = (page: Page, x: number, y: number, id: string): Promise<boolean> =>
  page.evaluate(
    ({ px, py, noteId }) =>
      document
        .elementFromPoint(px, py)
        ?.closest('[data-testid="sticky-note"]')
        ?.getAttribute('data-note-id') === noteId,
    { px: x, py: y, noteId: id },
  );

test.describe('story 2: sticky notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  test('TC-30: double-click empty space creates a yellow note centred on the point and typing lands in it', async ({
    page,
  }) => {
    await page.mouse.dblclick(400, 300);

    const note = await createdNote(page, 0);
    expect(note.color).toBe(DEFAULT_STICKY_COLOR);
    expect(note.text).toBe('');

    const box = await settleBox(page, note.id);
    expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 300)).toBeLessThanOrEqual(1);

    await page.keyboard.type('Hello');
    await expect(page.getByTestId('sticky-editor')).toHaveValue('Hello');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-text')).toHaveText('Hello');
    expect((await noteById(page, note.id)).text).toBe('Hello');
  });

  test('TC-31: at 50% zoom a 100x50 screen px drag moves the note 200x100 world units and keeps the grabbed point under the pointer', async ({
    page,
  }) => {
    await page.mouse.dblclick(400, 300);
    const note = await createdNote(page, 0);
    await page.keyboard.press('Escape');

    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    const camBefore = await camera(page);
    expect(camBefore.zoom).toBe(0.5);

    const before = await noteById(page, note.id);
    const boxBefore = await settleBox(page, note.id);
    // The world point of the note that the pointer grabs.
    const grab = { x: boxBefore.x + boxBefore.width / 2, y: boxBefore.y + boxBefore.height / 2 };
    const grabOffset = {
      x: screenToWorld(camBefore, grab).x - before.x,
      y: screenToWorld(camBefore, grab).y - before.y,
    };

    await drag(page, grab, { x: grab.x + 100, y: grab.y + 50 });

    const after = await noteById(page, note.id);
    expect(after.x - before.x).toBeCloseTo(200, 1);
    expect(after.y - before.y).toBeCloseTo(100, 1);

    const boxAfter = await settleBox(page, note.id);
    expect(Math.abs(boxAfter.x - (boxBefore.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - (boxBefore.y + 50))).toBeLessThanOrEqual(1);

    // sticky.grab_point: the same point of the note sits under the pointer.
    const camAfter = await camera(page);
    const grabbedNow = worldToScreen(camAfter, {
      x: after.x + grabOffset.x,
      y: after.y + grabOffset.y,
    });
    expect(Math.abs(grabbedNow.x - (grab.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(grabbedNow.y - (grab.y + 50))).toBeLessThanOrEqual(1);
    expect(await noteIdUnderPoint(page, grab.x + 100, grab.y + 50, note.id)).toBe(true);

    // sticky.no_pan: dragging a note never pans the board.
    expect(camAfter).toEqual({ x: 0, y: 0, zoom: 0.5 });
  });

  test('TC-32: at 200% zoom a 100x50 drag moves the note 50x25 world units and the dragged note ends on top', async ({
    page,
  }) => {
    await page.mouse.dblclick(400, 300);
    const first = await createdNote(page, 0);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(550, 400);
    const second = await createdNote(page, 1);
    await page.keyboard.press('Escape');
    // A click with no movement on empty board space clears the selection.
    await drag(page, { x: 1200, y: 200 }, { x: 1201, y: 201 });

    await setCamera(page, { x: 225, y: 150, zoom: 2 });
    const camBefore = await camera(page);
    const before = await noteById(page, first.id);
    const boxBefore = await settleBox(page, first.id);
    const grab = { x: boxBefore.x + 50, y: boxBefore.y + 50 };

    await drag(page, grab, { x: grab.x + 100, y: grab.y + 50 });

    const after = await noteById(page, first.id);
    expect(after.x - before.x).toBeCloseTo(50, 1);
    expect(after.y - before.y).toBeCloseTo(25, 1);

    // The dragged note is on top: in the area the two notes share the pointer
    // now hits the dragged one.
    const boxFirst = await settleBox(page, first.id);
    const boxSecond = await settleBox(page, second.id);
    const overlap = {
      x: Math.max(boxFirst.x, boxSecond.x) + 10,
      y: Math.max(boxFirst.y, boxSecond.y) + 10,
    };
    expect(overlap.x).toBeLessThan(
      Math.min(boxFirst.x + boxFirst.width, boxSecond.x + boxSecond.width),
    );
    expect(overlap.y).toBeLessThan(
      Math.min(boxFirst.y + boxFirst.height, boxSecond.y + boxSecond.height),
    );
    expect(await noteIdUnderPoint(page, overlap.x, overlap.y, first.id)).toBe(true);

    expect(await camera(page)).toEqual(camBefore);
  });

  test('TC-33: text auto-fits from 24px down to 10px, then the note stops growing and hides the overflow with a fade', async ({
    page,
  }) => {
    await page.mouse.dblclick(300, 300);
    const short = await createdNote(page, 0);
    await page.keyboard.type('Ship');
    await expect(page.getByTestId('sticky-editor')).toHaveValue('Ship');
    await page.keyboard.press('Escape');
    const shortText = noteLocator(page, short.id).getByTestId('sticky-text');
    await expect(shortText).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);
    await expect(shortText).toHaveAttribute('data-overflow', 'false');

    await page.mouse.dblclick(800, 400);
    const long = await createdNote(page, 1);
    await page.keyboard.insertText(PROSE_1000);
    await expect(page.getByTestId('sticky-editor')).toHaveValue(PROSE_1000);
    await page.keyboard.press('Escape');

    const longNote = noteLocator(page, long.id);
    const longText = longNote.getByTestId('sticky-text');
    await expect(longText).toHaveCSS('font-size', `${STICKY_FONT_MIN_PX}px`);
    await expect(longText).toHaveAttribute('data-overflow', 'true');

    const box = await settleBox(page, long.id);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(box.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);

    const measured = await longNote.evaluate((el) => {
      const textEl = el.querySelector<HTMLElement>('[data-testid="sticky-text"]')!;
      return {
        scrollHeight: textEl.scrollHeight,
        clientHeight: textEl.clientHeight,
        overflowY: getComputedStyle(textEl).overflowY,
        fade: Boolean(el.querySelector('[data-testid="sticky-fade"]')),
      };
    });
    expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);
    expect(measured.overflowY).toBe('hidden');
    expect(measured.fade).toBe(true);

    // Nothing is painted outside the note: the text box stays inside it.
    const textBox = await longNote.locator('[data-testid="sticky-text"]').boundingBox();
    expect(textBox!.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(textBox!.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(textBox!.x + textBox!.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(textBox!.y + textBox!.height).toBeLessThanOrEqual(box.y + box.height + 1);

    expect((await noteById(page, short.id)).text).toBe('Ship');
  });

  test('TC-34: the Sticky note button creates a note in the middle of the visible area far from the origin', async ({
    page,
  }) => {
    await setCamera(page, { x: 100000, y: -50000, zoom: 1 });
    await expect.poll(() => camera(page)).toEqual({ x: 100000, y: -50000, zoom: 1 });

    await page.getByRole('button', { name: 'Sticky note' }).click();

    const note = await createdNote(page, 0);
    const box = await settleBox(page, note.id);
    expect(Math.abs(box.x + box.width / 2 - VIEWPORT.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - VIEWPORT.height / 2)).toBeLessThanOrEqual(1);

    expect(await camera(page)).toEqual({ x: 100000, y: -50000, zoom: 1 });
    await page.keyboard.type('From the toolbar');
    await expect(page.getByTestId('sticky-editor')).toHaveValue('From the toolbar');
  });

  test('TC-27 + TC-29: recolour from the note toolbar, then delete it with the bin button', async ({
    page,
  }) => {
    await page.mouse.dblclick(500, 300);
    const note = await createdNote(page, 0);
    await page.keyboard.type('Faster onboarding');
    await page.keyboard.press('Escape');

    const before = await noteById(page, note.id);
    await page.getByRole('button', { name: 'Pink colour' }).click();

    await expect
      .poll(() => noteById(page, note.id).then((n) => n.color))
      .toBe('pink');
    const after = await noteById(page, note.id);
    expect(after.text).toBe('Faster onboarding');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);

    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect.poll(() => notes(page).then((all) => all.length)).toBe(0);
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  });

  test('golden path: capture two ideas, colour and group them, delete the duplicate', async ({
    page,
  }) => {
    // 1. Capture the first idea by double-clicking empty board space.
    await page.mouse.dblclick(400, 300);
    const first = await createdNote(page, 0);
    await page.keyboard.type('Faster onboarding');
    await page.keyboard.press('Escape');

    // 2. Colour it green from the note toolbar.
    await page.getByRole('button', { name: 'Green colour' }).click();
    await expect.poll(() => noteById(page, first.id).then((n) => n.color)).toBe('green');

    // 3. Capture a second idea.
    await page.mouse.dblclick(900, 500);
    const second = await createdNote(page, 1);
    await page.keyboard.type('Ship monthly');
    await page.keyboard.press('Escape');
    await drag(page, { x: 1200, y: 150 }, { x: 1201, y: 151 });
    expect((await notes(page)).length).toBe(2);

    // 4. Group them: drag the first note at 50% zoom.
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    const beforeDrag = await noteById(page, first.id);
    const box = await settleBox(page, first.id);
    await drag(page, { x: box.x + 20, y: box.y + 20 }, { x: box.x + 70, y: box.y + 40 });

    const dragged = await noteById(page, first.id);
    expect(dragged.x - beforeDrag.x).toBeCloseTo(100, 1);
    expect(dragged.y - beforeDrag.y).toBeCloseTo(40, 1);
    expect(dragged.text).toBe('Faster onboarding');
    expect(dragged.color).toBe('green');

    // 5. Delete the duplicate from the note toolbar.
    const secondBox = await settleBox(page, second.id);
    await page.mouse.click(secondBox.x + 20, secondBox.y + 20);
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect.poll(() => notes(page).then((all) => all.length)).toBe(1);

    const remaining = (await notes(page))[0]!;
    expect(remaining.id).toBe(first.id);
    expect(remaining).toMatchObject({ text: 'Faster onboarding', color: 'green' });
    const expected = expectedBox(remaining, await camera(page));
    const remainingBox = await boxOf(page, remaining.id);
    expect(Math.abs(remainingBox.x - expected.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(remainingBox.y - expected.y)).toBeLessThanOrEqual(1);
  });
});
