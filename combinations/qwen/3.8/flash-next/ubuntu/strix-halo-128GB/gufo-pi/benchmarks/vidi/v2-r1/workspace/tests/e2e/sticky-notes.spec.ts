import { expect, test, type Page } from '@playwright/test';

import { resetCamera } from '../../src/client/canvas/camera';

import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { LONG_PROSE, TEXT_1000, TEXT_1200 } from '../fixtures/texts';
import { BOARD_SIZE, getCamera, openBoard, setCamera } from './helpers/board';
import {
  PAINTED,
  colourSwatch,
  createWithButton,
  dblclickCreate,
  deleteButton,
  dragPointer,
  editor,
  noteCount,
  noteRects,
  pasteText,
  selectNoteAt,
  settle,
  topNoteAt,
  typeText,
} from './helpers/stickies';

/**
 * The acceptance points for stickies can only be judged in a browser: a note
 * has to land under the pointer that created it, stay under the pointer that
 * drags it at a zoom that is not 100 %, shrink its text instead of overflowing,
 * and always appear where the user is looking.
 *
 * The board starts at `{x: -640, y: -400, zoom: 1}` in a 1280x800 viewport, so
 * world 0,0 is the middle of the screen unless a test sets the camera.
 */

const VIEW = BOARD_SIZE;

/** A camera at `zoom` that still shows world 0,0 in the middle of the screen. */
function centredAt(zoom: number) {
  return { x: -VIEW.width / (2 * zoom), y: -VIEW.height / (2 * zoom), zoom };
}

async function centreOf(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const rects = await noteRects(page);
  const rect = rects[index];
  if (!rect) throw new Error(`no note at index ${index}`);
  return { x: rect.centreX, y: rect.centreY };
}

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  // Every test starts from the same, known view. The camera is only pushed when
  // it is not already there: setting it latches story 1's "has navigated", which
  // is what hides the first-use hint, so a test that cares about the hint must
  // not pay for a camera change it does not need.
  const start = resetCamera(VIEW);
  const camera = await getCamera(page);
  if (camera.x !== start.x || camera.y !== start.y || camera.zoom !== start.zoom) {
    await setCamera(page, start);
  }
});

test.describe('creating a note where the pointer was', () => {
  test('TC-30 double-click creates a note centred on the pointer, ready for typing', async ({
    page,
  }) => {
    const at = { x: 400, y: 300 };

    await dblclickCreate(page, at);
    await typeText(page, 'Hello');
    await page.keyboard.press('Escape');

    const rects = await noteRects(page);
    expect(rects).toHaveLength(1);
    const note = rects[0]!;
    // the note is centred on the point that was double-clicked
    expect(Math.abs(note.centreX - at.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(note.centreY - at.y)).toBeLessThanOrEqual(1);
    // the note is the size it claims to be, at 100 % zoom
    expect(note.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(note.color).toBe('yellow');
    await expect(page.getByTestId('sticky-text')).toHaveText('Hello');
  });

  test('the toolbar button creates a note in the middle of the view', async ({ page }) => {
    await createWithButton(page);
    await typeText(page, 'middle');
    await page.keyboard.press('Escape');

    const rects = await noteRects(page);
    expect(rects).toHaveLength(1);
    expect(Math.abs(rects[0]!.centreX - VIEW.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(rects[0]!.centreY - VIEW.height / 2)).toBeLessThanOrEqual(1);
  });

  // TC-34: the user has navigated far away and reaches for the button.
  test('TC-34 a note created after panning far away still appears in the middle of the view', async ({
    page,
  }) => {
    // the classic: the user has wandered off, then reaches for the button
    await setCamera(page, { x: 1_000_000, y: -750_000, zoom: 1 });

    await createWithButton(page);
    await typeText(page, 'found me');
    await page.keyboard.press('Escape');

    const rects = await noteRects(page);
    expect(rects).toHaveLength(1);
    const note = rects[0]!;
    expect(Math.abs(note.centreX - VIEW.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(note.centreY - VIEW.height / 2)).toBeLessThanOrEqual(1);
    // the camera did not move to find the note: the note came to the camera
    const camera = await getCamera(page);
    expect(camera.x).toBe(1_000_000);
    expect(camera.y).toBe(-750_000);
    await expect(page.getByTestId('sticky-text')).toHaveText('found me');
  });
});

test.describe('moving notes', () => {
  test('TC-31 at 50 % zoom the grabbed point stays under the pointer', async ({ page }) => {
    await setCamera(page, centredAt(0.5));
    await settle(page);
    const camera = await getCamera(page);
    expect(camera.zoom).toBe(0.5);

    const at = { x: 500, y: 400 };
    await dblclickCreate(page, at);
    await page.keyboard.press('Escape');
    const before = (await noteRects(page))[0]!;
    // at half size the note covers half as much screen
    expect(before.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 1);

    const grab = { x: before.centreX - 20, y: before.centreY - 10 };
    const delta = { x: 100, y: 50 };
    const end = await dragPointer(page, grab, delta);
    await settle(page);

    const after = (await noteRects(page))[0]!;
    // the note followed the pointer exactly
    expect(Math.abs(after.left - (before.left + delta.x))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.top - (before.top + delta.y))).toBeLessThanOrEqual(1);
    // the point of the note that was grabbed is still under the pointer
    expect(Math.abs(after.centreX - 20 - end.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.centreY - 10 - end.y)).toBeLessThanOrEqual(1);
    // world coordinates move by screen distance / zoom
    expect(after.worldX - before.worldX).toBeCloseTo(delta.x / 0.5, 6);
    expect(after.worldY - before.worldY).toBeCloseTo(delta.y / 0.5, 6);
  });

  // Raising the dragged note has to happen without moving its element in the
  // DOM: a node that is re-inserted under the pointer loses pointer capture, and
  // the drag would stop after the first move.
  test('TC-32 at 200 % zoom a drag moves half as many world units and brings the note to the front', async ({
    page,
  }) => {
    await setCamera(page, centredAt(2));
    await settle(page);

    // the note underneath, grabbed somewhere its overlay does not cover
    const underneath = { x: 500, y: 400 };
    await dblclickCreate(page, underneath);
    await typeText(page, 'under');
    await page.keyboard.press('Escape');

    // a second note on top of the first, created from the button (screen centre)
    await createWithButton(page);
    await typeText(page, 'over');
    await page.keyboard.press('Escape');

    let rects = await noteRects(page);
    expect(rects).toHaveLength(2);
    const before = rects.find((rect) => Math.round(rect.centreX) === underneath.x)!;
    const overlay = rects.find((rect) => Math.round(rect.centreX) !== underneath.x)!;
    expect(before).toBeDefined();
    expect(overlay).toBeDefined();
    const grabPoint = { x: underneath.x - 150, y: underneath.y };
    // the grab point is on the first note only
    expect(await topNoteAt(page, grabPoint)).toBe(before.id);

    const drag = { x: 100, y: 50 };
    await dragPointer(page, grabPoint, drag);
    await settle(page);

    rects = await noteRects(page);
    const after = rects.find((rect) => rect.id === before.id)!;
    // 100 screen pixels at 200 % is 50 world units
    expect(after.worldX - before.worldX).toBeCloseTo(50, 6);
    expect(after.worldY - before.worldY).toBeCloseTo(25, 6);
    expect(Math.abs(after.left - (before.left + drag.x))).toBeLessThanOrEqual(1);

    // the dragged note is now on top where the two overlap
    const overlap = {
      x: Math.max(after.left, overlay.left) + 20,
      y: Math.max(after.top, overlay.top) + 20,
    };
    expect(await topNoteAt(page, overlap)).toBe(before.id);
    const zAfter = await page.evaluate((id) => {
      const element = document.querySelector(`.sticky-note[data-note-id="${id}"]`) as HTMLElement;
      return Number(element.style.zIndex);
    }, before.id);
    const overlayZ = await page.evaluate((id) => {
      const element = document.querySelector(`.sticky-note[data-note-id="${id}"]`) as HTMLElement;
      return Number(element.style.zIndex);
    }, overlay.id);
    expect(zAfter).toBeGreaterThan(overlayZ);
  });

  test('a drag at 100 % keeps the world delta equal to the pointer delta', async ({ page }) => {
    const at = { x: 640, y: 400 };
    await dblclickCreate(page, at);
    await page.keyboard.press('Escape');
    const before = (await noteRects(page))[0]!;

    await dragPointer(page, { x: before.centreX, y: before.centreY }, { x: 120, y: -60 });
    await settle(page);

    const after = (await noteRects(page))[0]!;
    expect(after.worldX - before.worldX).toBeCloseTo(120, 6);
    expect(after.worldY - before.worldY).toBeCloseTo(-60, 6);
  });

  test('a press under the movement threshold selects without moving the note', async ({
    page,
  }) => {
    const at = { x: 640, y: 400 };
    await dblclickCreate(page, at);
    await typeText(page, 'shy');
    await page.keyboard.press('Escape');
    const before = (await noteRects(page))[0]!;

    // 2 px of pointer jitter: not a move
    await dragPointer(page, { x: before.centreX, y: before.centreY }, { x: 2, y: 0 });
    await settle(page);

    const after = (await noteRects(page))[0]!;
    expect(after.worldX).toBeCloseTo(before.worldX, 6);
    expect(after.worldY).toBeCloseTo(before.worldY, 6);
  });
});

test.describe('text that does not fit', () => {
  test('TC-33 one word is shown at the largest size; a full note shrinks and fades', async ({
    page,
  }) => {
    await dblclickCreate(page, { x: 640, y: 400 });
    await typeText(page, 'Faster onboarding');

    const field = editor(page);
    const editingSize = await field.evaluate((element) => getComputedStyle(element).fontSize);
    expect(editingSize).toBe(`${STICKY_FONT_MAX_PX}px`);

    // a whole note of prose: smaller text, never smaller than the readable floor
    await pasteText(page, TEXT_1000);
    await settle(page);

    const fitted = await field.evaluate((element) => ({
      fontSize: getComputedStyle(element).fontSize,
      overflow: (element as HTMLElement).dataset.overflow,
    }));
    const px = Number(fitted.fontSize.replace('px', ''));
    expect(px).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(px).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(fitted.overflow).toBe('true');

    await page.keyboard.press('Escape');

    const display = await page.evaluate(() => {
      const note = document.querySelector('.sticky-note') as HTMLElement;
      const text = document.querySelector('[data-testid="sticky-text"]') as HTMLElement;
      const fade = document.querySelector('.sticky-note__fade');
      const noteRect = note.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return {
        fontSize: getComputedStyle(text).fontSize,
        overflow: text.dataset.overflow,
        hasFade: Boolean(fade),
        inside:
          textRect.left >= noteRect.left - 1 &&
          textRect.right <= noteRect.right + 1 &&
          textRect.top >= noteRect.top - 1 &&
          textRect.bottom <= noteRect.bottom + 1,
        noteHeight: noteRect.height,
        scrollHeight: text.scrollHeight,
        text: text.textContent ?? '',
      };
    });

    expect(display.overflow).toBe('true');
    expect(display.hasFade).toBe(true);
    // the text is clipped to the note, never drawn outside it
    expect(display.inside).toBe(true);
    expect(display.scrollHeight).toBeGreaterThan(display.noteHeight);
    expect(display.text.length).toBe(TEXT_1000.length);
    expect(Number(display.fontSize.replace('px', ''))).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  });

  test('a note that is merely long keeps the largest font it can read at', async ({ page }) => {
    await dblclickCreate(page, { x: 640, y: 400 });
    await typeText(page, 'Ship the demo weekly.\nOwners write the follow-ups down.');
    await page.keyboard.press('Escape');

    const display = await page.evaluate(() => {
      const text = document.querySelector('[data-testid="sticky-text"]') as HTMLElement;
      return {
        fontSize: getComputedStyle(text).fontSize,
        overflow: text.dataset.overflow,
        hasFade: Boolean(document.querySelector('.sticky-note__fade')),
      };
    });

    expect(display.overflow).toBe('false');
    expect(display.hasFade).toBe(false);
    expect(Number(display.fontSize.replace('px', ''))).toBeGreaterThan(STICKY_FONT_MIN_PX);
    expect(Number(display.fontSize.replace('px', ''))).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
  });

  test('a note filled past the limit keeps 1,000 characters and says so', async ({ page }) => {
    await dblclickCreate(page, { x: 640, y: 400 });
    await pasteText(page, TEXT_1200);

    const kept = await editor(page).evaluate((element) => (element as HTMLTextAreaElement).value);
    expect(kept.length).toBe(TEXT_1000.length);
    await expect(page.getByTestId('sticky-counter')).toHaveText(`${TEXT_1000.length}/1000`);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-text')).toHaveText(LONG_PROSE.slice(0, 1000));
  });
});

test.describe('colour, duplication and deletion', () => {
  test('TC-30 golden path: brainstorm, recolour, delete one note', async ({ page }) => {
    await dblclickCreate(page, { x: 400, y: 300 });
    await typeText(page, 'Hello');
    await page.keyboard.press('Escape');

    await dblclickCreate(page, { x: 900, y: 300 });
    await typeText(page, 'drop me');
    await page.keyboard.press('Escape');

    expect(await noteCount(page)).toBe(2);

    // pick the first note again and colour it green
    await selectNoteAt(page, { x: 400, y: 300 });
    await colourSwatch(page, 'green').click();
    expect(await paintedAt(page, { x: 400, y: 300 })).toBe(PAINTED.green);

    // and remove the second one with the keyboard
    await selectNoteAt(page, { x: 900, y: 300 });
    await page.keyboard.press('Delete');
    await settle(page);

    expect(await noteCount(page)).toBe(1);
    const rects = await noteRects(page);
    expect(Math.abs(rects[0]!.centreX - 400)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('sticky-text')).toHaveText('Hello');
    expect(await paintedAt(page, { x: 400, y: 300 })).toBe(PAINTED.green);
  });

  test('the note toolbar floats above the selected note and keeps its screen size', async ({
    page,
  }) => {
    await dblclickCreate(page, { x: 640, y: 500 });
    await typeText(page, 'toolbar');
    await page.keyboard.press('Escape');

    const at100 = await toolbarBox(page);
    const noteBox = (await noteRects(page))[0]!;
    // the toolbar sits above the note, inside the viewport
    expect(at100.bottom).toBeLessThanOrEqual(noteBox.top + 1);
    expect(at100.top).toBeGreaterThanOrEqual(0);

    await setCamera(page, centredAt(2));
    await settle(page);
    await selectNoteAt(page, await centreOf(page));

    const at200 = await toolbarBox(page);
    expect(Math.abs(at200.width - at100.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(at200.height - at100.height)).toBeLessThanOrEqual(1);
  });

  test('the bin button removes the note it belongs to', async ({ page }) => {
    await dblclickCreate(page, { x: 500, y: 400 });
    await typeText(page, 'temporary');
    await page.keyboard.press('Escape');

    await deleteButton(page).click();
    await settle(page);

    expect(await noteCount(page)).toBe(0);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
  });

  test('selecting a note by pressing it does not start editing', async ({ page }) => {
    await dblclickCreate(page, { x: 640, y: 400 });
    await typeText(page, 'tap me');
    await page.keyboard.press('Escape');

    await selectNoteAt(page, { x: 640, y: 400 });

    await expect(editor(page)).toHaveCount(0);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    // a second double-click opens it again, with the text kept
    await page.mouse.dblclick(640, 400);
    await expect(editor(page)).toHaveValue('tap me');
  });
});

/** The painted colour of the topmost note at a screen point. */
async function paintedAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    for (const element of document.elementsFromPoint(x, y)) {
      if (element instanceof HTMLElement && element.classList.contains('sticky-note')) {
        return getComputedStyle(element).backgroundColor;
      }
    }
    return null;
  }, at);
}

async function toolbarBox(page: Page): Promise<{ top: number; bottom: number; width: number; height: number }> {
  const box = await page.getByTestId('note-toolbar').boundingBox();
  if (!box) throw new Error('note toolbar is not visible');
  return { top: box.y, bottom: box.y + box.height, width: box.width, height: box.height };
}
