import { expect, test } from '@playwright/test';
import {
  VIEWPORT_SIZE,
  cameraFromDom,
  clickAndWaitForZoomChange,
  openBoard,
  originCentre,
  setCamera,
  waitForRender,
  zoomInButton,
} from './helpers/board';
import {
  createNoteAt,
  createNoteWithToolbar,
  doubleClickNote,
  dragNoteBy,
  emptyBoardPoint,
  fadeVisible,
  noteCentre,
  noteCount,
  noteLocator,
  noteModels,
  openEditorCount,
  typeIntoEditor,
  type NoteModel,
} from './helpers/sticky';
import { SHORT_NOTE_TEXT, TEXT_1000 } from '../fixtures/texts';

/**
 * Story 2 — sticky notes end to end on a real browser: the pixel-accurate
 * create/drag geometry (which only a real browser can check), the colour
 * presets, text overflow with a real font, and the create-while-panned-away
 * rule.
 */

/** Camera that puts the world origin in the middle of the screen at `zoom`. */
function centredAt(zoom: number) {
  return { x: -VIEWPORT_SIZE.width / 2 / zoom, y: -VIEWPORT_SIZE.height / 2 / zoom, zoom };
}

/** The id of the note painted at a screen point, or null if it is bare board. */
async function noteIdAtPoint(page: import('@playwright/test').Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('[data-sticky-note]')?.getAttribute('data-sticky-id') ?? null;
    },
    { px: x, py: y },
  );
}

function find(notes: NoteModel[], id: string): NoteModel {
  const note = notes.find((n) => n.id === id);
  if (!note) throw new Error(`note ${id} is gone from the model`);
  return note;
}

test.describe('sticky notes', () => {
  test('double-click at a point creates a note centred there and typing lands in it (TC-30)', async ({
    page,
  }, testInfo) => {
    await openBoard(page);

    const id = await createNoteAt(page, 400, 300);
    expect(await noteCount(page)).toBe(1);

    // The note is centred on the double-click point: within a pixel.
    const centre = await noteCentre(page, id);
    expect(Math.abs(centre.x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - 300)).toBeLessThanOrEqual(1);

    // Editing is active immediately: typed characters appear without a click.
    const editor = page.locator('textarea[data-testid="sticky-textarea"]');
    await expect(editor).toHaveCount(1);
    await expect(editor).toBeFocused();
    await typeIntoEditor(page, 'Hello');
    await waitForRender(page);
    expect(find(await noteModels(page), id).text).toBe('Hello');

    await page.screenshot({ path: testInfo.outputPath('tc30-note.png') });
    await testInfo.attach('tc30-note.png', {
      path: testInfo.outputPath('tc30-note.png'),
      contentType: 'image/png',
    });

    // Blur (a click on empty board) ends editing; the text stays on the note.
    await page.mouse.click(60, 720);
    await waitForRender(page);
    await expect(openEditorCount(page)).resolves.toBe(0);
    await expect(noteLocator(page, id).locator('[data-testid="sticky-note-text"]')).toHaveText(
      'Hello',
    );
  });

  test('a drag at 50% zoom moves the note by exactly the pointer distance and converts to world units (TC-31)', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, centredAt(0.5));

    const id = await createNoteAt(page, 400, 300);
    await page.keyboard.press('Escape');
    await waitForRender(page);
    const before = find(await noteModels(page), id);
    const grab = await noteCentre(page, id);

    await dragNoteBy(page, id, 100, 50);

    // Screen geometry: the point grabbed is still under the pointer, within a pixel.
    const after = await noteCentre(page, id);
    expect(Math.abs(after.x - (grab.x + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (grab.y + 50))).toBeLessThanOrEqual(1);

    // World geometry: 100 screen px at 50% zoom is 200 world units.
    const moved = find(await noteModels(page), id);
    expect(moved.x - before.x).toBeCloseTo(200, 1);
    expect(moved.y - before.y).toBeCloseTo(100, 1);
  });

  test('a drag at 200% zoom converts to world units and draws the note above the one it overlaps (TC-32)', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, centredAt(2));

    const lower = await createNoteAt(page, 400, 300);
    await page.keyboard.press('Escape');
    const upper = await createNoteAt(page, 700, 600);
    await page.keyboard.press('Escape');
    await waitForRender(page);

    // A point where both notes sit; the newer one is on top.
    expect(await noteIdAtPoint(page, 550, 450)).toBe(upper);

    const before = find(await noteModels(page), lower);
    await dragNoteBy(page, lower, 100, 50);

    const moved = find(await noteModels(page), lower);
    expect(moved.x - before.x).toBeCloseTo(50, 1);
    expect(moved.y - before.y).toBeCloseTo(25, 1);

    // Dragging a note onto another raises it: the overlap is now the dragged note.
    expect(await noteIdAtPoint(page, 550, 450)).toBe(lower);
    const models = await noteModels(page);
    expect(find(models, lower).z).toBeGreaterThan(find(models, upper).z);
  });

  test('text is shown at the largest size, shrinks to fit, then clips with a fade (TC-33)', async ({
    page,
  }) => {
    await openBoard(page);
    const point = await emptyBoardPoint(page);
    const id = await createNoteAt(page, point.x, point.y);
    const editor = page.locator('textarea[data-testid="sticky-textarea"]');
    const textEl = noteLocator(page, id).locator('[data-testid="sticky-note-text"]');

    // A short note: the largest allowed size, nothing clipped, no fade.
    await typeIntoEditor(page, SHORT_NOTE_TEXT);
    await expect(textEl).toHaveCSS('font-size', '24px');
    expect(await fadeVisible(page, id)).toBe(false);
    expect(await textEl.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await page.keyboard.press('Escape');
    await waitForRender(page);

    // 1,000 characters: still readable (never below the minimum), the note does
    // not grow, and what does not fit is hidden behind the fade.
    await doubleClickNote(page, id);
    await editor.fill(TEXT_1000);
    await waitForRender(page);
    await expect(textEl).toHaveText(TEXT_1000);
    const fitted = await textEl.evaluate((el) => ({
      fontPx: parseFloat(getComputedStyle(el).fontSize),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(fitted.fontPx).toBeGreaterThanOrEqual(10);
    expect(fitted.fontPx).toBeLessThanOrEqual(24);
    expect(fitted.scrollHeight).toBeGreaterThan(fitted.clientHeight + 1);
    expect(fitted.scrollWidth).toBeLessThanOrEqual(fitted.clientWidth + 1);
    expect(await fadeVisible(page, id)).toBe(true);
    const box = await noteLocator(page, id).boundingBox();
    expect(box?.width).toBeCloseTo(200, 3);
    expect(box?.height).toBeCloseTo(200, 3);

    // A 1,000 character note is within 50 characters of the limit, so the
    // counter shows while editing, and nothing past the limit was kept.
    await expect(page.locator('[data-testid="sticky-counter"]')).toHaveText('1000/1000');
    expect(find(await noteModels(page), id).text.length).toBe(1000);
    await page.keyboard.press('Escape');
    await waitForRender(page);
    expect(find(await noteModels(page), id).text.length).toBe(1000);
  });

  test('the toolbar creates a note at the centre of the visible area even when panned far away (TC-34)', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 500_000, y: -300_000, zoom: 1 });

    const id = await createNoteWithToolbar(page);
    await expect(noteLocator(page, id)).toBeVisible();
    const centre = await noteCentre(page, id);
    expect(Math.abs(centre.x - VIEWPORT_SIZE.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - VIEWPORT_SIZE.height / 2)).toBeLessThanOrEqual(1);

    // It is centred on the world point at the middle of the screen, and editable.
    const note = find(await noteModels(page), id);
    // Screen (640, 400) is world (500000 + 640, -300000 + 400) with this camera.
    expect(note.x).toBeCloseTo(500_000 + VIEWPORT_SIZE.width / 2 - 100, 1);
    expect(note.y).toBeCloseTo(-300_000 + VIEWPORT_SIZE.height / 2 - 100, 1);
    await expect(page.locator('textarea[data-testid="sticky-textarea"]')).toBeFocused();
    await typeIntoEditor(page, 'here');
    await page.keyboard.press('Escape');
    expect(find(await noteModels(page), id).text).toBe('here');

    // And the rest of the board is undisturbed by the jump.
    const cam = await cameraFromDom(page);
    expect(cam).toEqual({ x: 500_000, y: -300_000, zoom: 1 });
  });

  test('a brainstorm: create, type, move at 50% zoom, recolour, delete', async ({ page }) => {
    await openBoard(page);

    const first = await createNoteAt(page, 360, 300);
    await typeIntoEditor(page, 'Kickoff');
    await page.keyboard.press('Escape');
    const second = await createNoteAt(page, 880, 520);
    await typeIntoEditor(page, 'Retro');
    await page.keyboard.press('Escape');
    await waitForRender(page);
    expect(await noteCount(page)).toBe(2);

    // Move the first note while zoomed out.
    await setCamera(page, centredAt(0.5));
    const before = find(await noteModels(page), first);
    await dragNoteBy(page, first, 100, 50);
    const moved = find(await noteModels(page), first);
    expect(moved.x - before.x).toBeCloseTo(200, 1);
    expect(moved.y - before.y).toBeCloseTo(100, 1);
    // The second note did not move.
    const secondBefore = find(await noteModels(page), second);

    // Recolour the second note, then delete the first one.
    await noteLocator(page, second).click();
    await page.getByRole('button', { name: 'Pink colour' }).click();
    await waitForRender(page);
    expect(find(await noteModels(page), second).color).toBe('pink');

    await noteLocator(page, first).click();
    await page.keyboard.press('Delete');
    await waitForRender(page);

    // The board ends as the brainstorm intended: one pink note, unmoved.
    const models = await noteModels(page);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe(second);
    expect(models[0]?.text).toBe('Retro');
    expect(models[0]?.color).toBe('pink');
    expect(models[0]?.x).toBeCloseTo(secondBefore.x, 3);
    expect(models[0]?.y).toBeCloseTo(secondBefore.y, 3);
    await expect(page.getByRole('button', { name: 'Delete note' })).toHaveCount(0);
  });

  test('the six colour presets all apply and only one editor is ever open', async ({ page }) => {
    await openBoard(page);
    const names = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'] as const;
    const keys = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
    // Spread out, so no note (nor the toolbar floating above it) overlaps
    // another note or another piece of chrome.
    const spots = [
      { x: 340, y: 260 },
      { x: 640, y: 260 },
      { x: 940, y: 260 },
      { x: 340, y: 560 },
      { x: 640, y: 560 },
      { x: 940, y: 560 },
    ];

    for (const [index, name] of names.entries()) {
      const spot = spots[index]!;
      const id = await createNoteAt(page, spot.x, spot.y);
      await expect(openEditorCount(page)).resolves.toBe(1);
      await page.keyboard.press('Escape');
      await waitForRender(page);
      await expect(openEditorCount(page)).resolves.toBe(0);

      await noteLocator(page, id).click();
      await expect(openEditorCount(page)).resolves.toBe(0);
      await page.getByRole('button', { name: `${name} colour` }).click();
      await waitForRender(page);
      expect(find(await noteModels(page), id).color).toBe(keys[index]);
      await expect(noteLocator(page, id)).toHaveAttribute('data-color', keys[index]!);
      // Choosing a colour keeps the note selected and does not open an editor.
      await expect(noteLocator(page, id)).toHaveAttribute('data-selected', 'true');
    }

    expect(await noteCount(page)).toBe(6);
    expect(await openEditorCount(page)).toBe(0);

    // Selecting a second note leaves exactly one editor open.
    const ids = (await noteModels(page)).map((n) => n.id);
    await noteLocator(page, ids[0]).click();
    await noteLocator(page, ids[1]).dblclick();
    await expect(openEditorCount(page)).resolves.toBe(1);
    await page.keyboard.press('Escape');
    await expect(openEditorCount(page)).resolves.toBe(0);
  });

  test('double-click on an existing note edits it instead of creating another', async ({
    page,
  }) => {
    await openBoard(page);
    const point = await emptyBoardPoint(page);
    const id = await createNoteAt(page, point.x, point.y);
    await typeIntoEditor(page, 'unchanged');
    await page.keyboard.press('Escape');
    await waitForRender(page);
    const before = find(await noteModels(page), id);

    await doubleClickNote(page, id);
    await expect(openEditorCount(page)).resolves.toBe(1);
    expect(await noteCount(page)).toBe(1);
    await page.keyboard.press('Escape');
    await waitForRender(page);

    const after = find(await noteModels(page), id);
    expect(after.text).toBe('unchanged');
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    await expect(noteLocator(page, id)).toHaveAttribute('data-selected', 'true');
  });

  test('a note panned a million units away comes back with its text intact', async ({ page }) => {
    await openBoard(page);
    const centre = await originCentre(page);
    const id = await createNoteAt(page, centre.x, centre.y);
    await typeIntoEditor(page, 'still here');
    await page.keyboard.press('Escape');
    await waitForRender(page);
    const home = await cameraFromDom(page);

    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });
    await waitForRender(page);
    const far = find(await noteModels(page), id);
    expect(far.x).toBeCloseTo(-100, 3);
    // Off the screen: the model is unchanged, nothing is drawn on screen.
    const box = await noteLocator(page, id).boundingBox();
    if (!box) throw new Error('the note element disappeared');
    expect(box.x > VIEWPORT_SIZE.width || box.x + box.width < 0).toBe(true);

    await setCamera(page, home);
    await waitForRender(page);
    await expect(noteLocator(page, id)).toBeVisible();
    await expect(noteLocator(page, id).locator('[data-testid="sticky-note-text"]')).toHaveText(
      'still here',
    );
  });

  test('the toolbar button creates a note in the middle of the visible area and focuses it', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createNoteWithToolbar(page);
    const note = find(await noteModels(page), id);
    // At zoom 1 the viewport centre is the world origin.
    expect(note.x).toBeCloseTo(-100, 1);
    expect(note.y).toBeCloseTo(-100, 1);
    await expect(page.locator('textarea[data-testid="sticky-textarea"]')).toBeFocused();
    await typeIntoEditor(page, 'from the toolbar');
    await page.keyboard.press('Escape');
    expect(find(await noteModels(page), id).text).toBe('from the toolbar');
  });

  test('the bin removes a note, and the board still works afterwards', async ({ page }) => {
    await openBoard(page);
    const centre = await originCentre(page);
    const keep = await createNoteAt(page, centre.x - 260, centre.y);
    await page.keyboard.press('Escape');
    const doomed = await createNoteAt(page, centre.x + 60, centre.y);
    await page.keyboard.press('Escape');
    expect(await noteCount(page)).toBe(2);

    await noteLocator(page, doomed).click();
    await page.getByRole('button', { name: 'Delete note' }).click();
    await waitForRender(page);
    expect(await noteCount(page)).toBe(1);
    expect((await noteModels(page)).map((n) => n.id)).toEqual([keep]);
    // No stale floating toolbar, and a new note can still be created.
    await expect(page.getByRole('button', { name: 'Delete note' })).toHaveCount(0);
    await createNoteWithToolbar(page);
    expect(await noteCount(page)).toBe(2);
  });

  test('notes stay anchored to the board and keep their world size when zooming', async ({
    page,
  }) => {
    await openBoard(page);
    const centre = await originCentre(page);
    // Away from the zoom anchor, so zooming visibly moves it across the screen.
    const id = await createNoteAt(page, centre.x + 260, centre.y + 160);
    await typeIntoEditor(page, 'anchored');
    await page.keyboard.press('Escape');
    await waitForRender(page);

    const before = await noteCentre(page, id);
    await clickAndWaitForZoomChange(page, zoomInButton(page));
    await waitForRender(page);
    const zoomed = await cameraFromDom(page);
    expect(zoomed.zoom).toBeGreaterThan(1);

    const after = await noteCentre(page, id);
    const scale = zoomed.zoom;
    expect(after.x).toBeCloseTo((before.x - 640) * scale + 640, 1);
    expect(after.y).toBeCloseTo((before.y - 400) * scale + 400, 1);
    const box = await noteLocator(page, id).boundingBox();
    expect(box?.width).toBeCloseTo(200 * scale, 1);
    expect(box?.height).toBeCloseTo(200 * scale, 1);
    // The note is the same note, in the same place in the world.
    expect(find(await noteModels(page), id).text).toBe('anchored');
  });
});
