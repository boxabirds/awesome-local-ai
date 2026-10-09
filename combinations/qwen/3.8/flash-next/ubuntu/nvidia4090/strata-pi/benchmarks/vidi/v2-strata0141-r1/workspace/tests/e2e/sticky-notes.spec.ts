import { expect, test } from '@playwright/test';
import {
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_TEXT } from '../fixtures/texts';
import {
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  VIEWPORT_CENTRE,
  dragBoard,
  getCamera,
  near,
  openBoard,
  setCamera,
} from './helpers/board';
import {
  clickCreateStickyButton,
  clickDeleteButton,
  clickSwatch,
  createNoteAt,
  dragNote,
  editorMetrics,
  getNotes,
  noteAttribute,
  noteBox,
  noteCard,
  noteCentre,
  selectNote,
  textMetrics,
  topNoteIdAt,
  noteBackground,
} from './helpers/sticky';

/**
 * Story 2 - sticky notes, in real browsers.
 *
 * These tests drive real pointer and keyboard events and measure what is drawn,
 * which is the only way to verify text fit and drag-under-the-pointer accuracy.
 * Document state is read through the test-only `window.__vidi6` hooks so the
 * assertions are about the model, not about how the model was reached.
 */

test.describe('story 2: sticky notes', () => {
  test('TC-30: a real double-click captures an idea where the pointer was', async ({ page }) => {
    await openBoard(page);

    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Hello');

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe('Hello');

    const box = await noteBox(page, notes[0]!.id);
    expect(near(box.x + box.width / 2, 400, 1)).toBe(true);
    expect(near(box.y + box.height / 2, 300, 1)).toBe(true);
    // 200 x 200 board units drawn at 100% zoom.
    expect(near(box.width, STICKY_SIZE_WORLD, 1)).toBe(true);
    expect(near(box.height, STICKY_SIZE_WORLD, 1)).toBe(true);

    // The double-click was not also a pan.
    const camera = await getCamera(page);
    expect(near(camera.zoom, 1, 0.001)).toBe(true);
    expect(near(camera.x, -VIEWPORT_WIDTH / 2, 1)).toBe(true);
    expect(near(camera.y, -VIEWPORT_HEIGHT / 2, 1)).toBe(true);
  });

  test('golden path: capture, arrange at 50%, recolour and delete (TC-30, TC-31, TC-27, TC-25)', async ({ page }) => {
    await openBoard(page);

    // Capture: double-click the empty board and type.
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    let notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe('Hello');
    const drawn = await noteBox(page, notes[0]!.id);
    expect(near(drawn.x + drawn.width / 2, 400, 1)).toBe(true);
    expect(near(drawn.y + drawn.height / 2, 300, 1)).toBe(true);
    expect(await noteAttribute(page, notes[0]!.id, 'data-selected')).toBe('true');

    // Arrange: zoom out to 50% and drag the note by (100, 50) screen pixels.
    await setCamera(page, { x: -VIEWPORT_WIDTH / 2, y: -VIEWPORT_HEIGHT / 2, zoom: 0.5 });
    await page.keyboard.press('Escape'); // make sure the note is Selected, not Editing
    const before = (await getNotes(page))[0]!;
    const grab = await dragNote(page, before.id, 100, 50);

    notes = await getNotes(page);
    expect(near(notes[0]!.x - before.x, 200, 1)).toBe(true); // 100 screen px / 0.5
    expect(near(notes[0]!.y - before.y, 100, 1)).toBe(true); // 50 screen px / 0.5
    const centre = await noteCentre(page, before.id);
    expect(near(centre.x, grab.x + 100, 1)).toBe(true);
    expect(near(centre.y, grab.y + 50, 1)).toBe(true);
    expect(notes[0]!.text).toBe('Hello');

    // Recolour from the note toolbar; nothing else about the note changes.
    const unchanged = { x: notes[0]!.x, y: notes[0]!.y, z: notes[0]!.z, text: notes[0]!.text };
    await clickSwatch(page, 'pink');
    notes = await getNotes(page);
    expect(notes[0]!.color).toBe('pink');
    expect(await noteBackground(page, notes[0]!.id)).toBe('rgb(244, 143, 177)');
    expect({ x: notes[0]!.x, y: notes[0]!.y, z: notes[0]!.z, text: notes[0]!.text }).toEqual(unchanged);
    expect(await noteAttribute(page, notes[0]!.id, 'data-selected')).toBe('true');

    // Delete with the keyboard.
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    expect(await getNotes(page)).toHaveLength(0);
    expect(await page.locator('[data-testid^="sticky-note-"]').count()).toBe(0);
  });

  test('TC-31: at 50% zoom a drag moves the note by screen distance / zoom', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    expect(await page.getByTestId('zoom-percent').textContent()).toBe('50%');

    const id = await createNoteAt(page, { x: 520, y: 430 });
    const before = (await getNotes(page))[0]!;

    const grab = await dragNote(page, id, 100, 50);

    const after = (await getNotes(page))[0]!;
    expect(near(after.x - before.x, 100 / 0.5, 1)).toBe(true);
    expect(near(after.y - before.y, 50 / 0.5, 1)).toBe(true);

    // The grabbed point stays under the pointer.
    const centre = await noteCentre(page, id);
    expect(near(centre.x, grab.x + 100, 1)).toBe(true);
    expect(near(centre.y, grab.y + 50, 1)).toBe(true);

    // The note is still selected and the drag was not a board pan.
    expect(await noteAttribute(page, id, 'data-selected')).toBe('true');
    const camera = await getCamera(page);
    expect(near(camera.x, 0, 0.001)).toBe(true);
    expect(near(camera.y, 0, 0.001)).toBe(true);
    expect(near(camera.zoom, 0.5, 0.001)).toBe(true);
  });

  test('TC-32: at 200% zoom a drag moves half the distance and brings the note to front', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    expect(await page.getByTestId('zoom-percent').textContent()).toBe('200%');

    // Two overlapping notes; `moving` is created first, so the other one covers it.
    const moving = await createNoteAt(page, { x: 320, y: 220 });
    const covering = await createNoteAt(page, { x: 470, y: 370 });

    const overlap = { x: 800, y: 600 };
    expect(await topNoteIdAt(page, overlap)).toBe(`sticky-note-${covering}`);

    const before = (await getNotes(page)).find((note) => note.id === moving)!;
    const grab = await dragNote(page, moving, 100, 50);

    const after = (await getNotes(page)).find((note) => note.id === moving)!;
    expect(near(after.x - before.x, 100 / 2, 1)).toBe(true);
    expect(near(after.y - before.y, 50 / 2, 1)).toBe(true);
    const centre = await noteCentre(page, moving);
    expect(near(centre.x, grab.x + 100, 1)).toBe(true);
    expect(near(centre.y, grab.y + 50, 1)).toBe(true);

    // Drawn above the note it now overlaps, both in z and in what is painted.
    expect(after.z).toBeGreaterThan((await getNotes(page)).find((n) => n.id === covering)!.z);
    expect(await topNoteIdAt(page, overlap)).toBe(`sticky-note-${moving}`);
  });

  test('TC-33: text fits 24px by default, shrinks to at least 10px and clips past it', async ({ page }) => {
    await openBoard(page);

    const id = await createNoteAt(page, { x: 0, y: 0 });
    // TC-35: double-clicking the note edits it instead of creating another one.
    await page.mouse.dblclick(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y);
    expect(await getNotes(page)).toHaveLength(1);
    expect(await page.locator('[data-testid="sticky-editor"]').count()).toBe(1);

    await page.keyboard.type('Ship it');
    const short = await editorMetrics(page);
    expect(short.fontSize).toBe(STICKY_FONT_MAX_PX);

    await page.keyboard.insertText(LONG_TEXT);
    const long = await editorMetrics(page);
    expect(long.value.length).toBe(STICKY_TEXT_MAX_CHARS); // clamped while typing
    expect(long.fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(long.fontSize).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(long.scrollHeight).toBeGreaterThan(long.clientHeight); // the rest is clipped

    await page.keyboard.press('Escape');

    const drawn = await textMetrics(page, id);
    expect(drawn.fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(drawn.fontSize).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(drawn.contentHeight).toBeGreaterThan(drawn.clipHeight);
    expect(drawn.clipScrollHeight).toBeGreaterThan(drawn.clipHeight);
    expect(drawn.overflow).toBe('hidden'); // nothing paints outside the note
    expect(drawn.fadeVisible).toBe(true); // the fade shows where text is cut off
    expect(await noteAttribute(page, id, 'data-overflow')).toBe('true');

    // The note itself never grows to fit the text.
    const box = await noteBox(page, id);
    expect(near(box.width, STICKY_SIZE_WORLD, 1)).toBe(true);
    expect(near(box.height, STICKY_SIZE_WORLD, 1)).toBe(true);

    // Where the text is drawn: it starts inside the note and runs past its
    // bottom edge, so the part beyond the edge is clipped rather than painted.
    const geometry = await noteCard(page, id).evaluate((note) => {
      const el = note as HTMLElement;
      const clip = el.querySelector('.sticky-note__clip') as HTMLElement;
      const text = el.querySelector('[data-testid^="sticky-text-"]') as HTMLElement;
      const noteRect = el.getBoundingClientRect();
      const clipRect = clip.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return {
        clipCoversNote:
          Math.abs(clipRect.width - noteRect.width) <= 1 && Math.abs(clipRect.height - noteRect.height) <= 1,
        textStartsInside: textRect.top >= clipRect.top - 1 && textRect.left >= clipRect.left - 1,
        textRunsPastTheEdge: textRect.bottom > clipRect.bottom + 1,
        clippedPaintHeight: Math.min(textRect.bottom, clipRect.bottom) - textRect.top,
      };
    });
    expect(geometry.clipCoversNote).toBe(true);
    expect(geometry.textStartsInside).toBe(true);
    expect(geometry.textRunsPastTheEdge).toBe(true);
    // What is actually painted fits inside the note.
    expect(geometry.clippedPaintHeight).toBeLessThanOrEqual(box.height);
  });

  test('TC-34: the toolbar creates a note on screen however far the board is panned', async ({ page }) => {
    await openBoard(page);
    await dragBoard(page, { x: VIEWPORT_CENTRE.x, y: VIEWPORT_CENTRE.y }, -6000, -4000);

    const camera = await getCamera(page);
    expect(Math.abs(camera.x)).toBeGreaterThan(1000);

    await clickCreateStickyButton(page);

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    const box = await noteBox(page, notes[0]!.id);
    expect(near(box.x + box.width / 2, VIEWPORT_CENTRE.x, 2)).toBe(true);
    expect(near(box.y + box.height / 2, VIEWPORT_CENTRE.y, 2)).toBe(true);

    // The note is inside the tested extent around the point the screen shows.
    const shown = { x: camera.x + VIEWPORT_CENTRE.x, y: camera.y + VIEWPORT_CENTRE.y };
    expect(Math.abs(notes[0]!.x + STICKY_SIZE_WORLD / 2 - shown.x)).toBeLessThan(2);
    expect(Math.abs(notes[0]!.y + STICKY_SIZE_WORLD / 2 - shown.y)).toBeLessThan(2);

    // It is created in Editing state, ready to type.
    expect(await page.locator('[data-testid="sticky-editor"]').count()).toBe(1);
  });

  test('the note toolbar keeps a constant screen size at 50% and 200%', async ({ page }) => {
    await openBoard(page);

    const sizes: number[] = [];
    for (const zoom of [0.5, 2]) {
      await setCamera(page, { x: 0, y: 0, zoom });
      const id = await createNoteAt(page, { x: 400, y: 300 });
      await selectNote(page, id);
      const swatch = await noteCard(page, id).locator('[data-testid="swatch-yellow"]').boundingBox();
      if (!swatch) {
        throw new Error('the colour swatch is not drawn');
      }
      sizes.push(swatch.width);
      const box = await noteBox(page, id);
      // The note itself scales with zoom; the toolbar does not.
      expect(near(box.width, STICKY_SIZE_WORLD * zoom, 1)).toBe(true);
    }

    expect(near(sizes[0]!, sizes[1]!, 1)).toBe(true);
    expect(sizes[0]!).toBeGreaterThanOrEqual(22);
    expect(sizes[0]!).toBeLessThanOrEqual(44);
  });

  test('a drag below the threshold selects the note without moving it', async ({ page }) => {
    await openBoard(page);

    const id = await createNoteAt(page, { x: 0, y: 0 });
    const before = (await getNotes(page))[0]!;
    const centre = await noteCentre(page, id);

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + DRAG_THRESHOLD_PX - 1, centre.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(80);

    const after = (await getNotes(page))[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(await noteAttribute(page, id, 'data-selected')).toBe('true');
  });

  test('the bin button and the Delete key remove notes and the board keeps working', async ({ page }) => {
    await openBoard(page);

    const keep = await createNoteAt(page, { x: -260, y: -120 });
    const gone = await createNoteAt(page, { x: 120, y: 60 });
    await selectNote(page, gone);

    await clickDeleteButton(page); // the bin button on the note toolbar

    await page.waitForTimeout(80);

    const notes = await getNotes(page);
    expect(notes.map((note) => note.id)).toEqual([keep]);
    expect(await page.locator('[data-testid^="note-toolbar"]').count()).toBe(0);

    // The remaining note can still be selected and dragged.
    const before = (await getNotes(page))[0]!;
    await dragNote(page, keep, 60, 40);
    const after = (await getNotes(page))[0]!;
    expect(near(after.x - before.x, 60, 1)).toBe(true);
    expect(near(after.y - before.y, 40, 1)).toBe(true);
  });
});
