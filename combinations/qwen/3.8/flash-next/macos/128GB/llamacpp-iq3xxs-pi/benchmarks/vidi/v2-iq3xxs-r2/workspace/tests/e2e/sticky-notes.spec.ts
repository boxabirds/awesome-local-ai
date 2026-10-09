import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { PROSE_1000, SHORT_NOTE } from '../fixtures/texts';
import {
  VIEWPORT_CENTRE,
  boardNotes,
  clickStickyNoteButton,
  clickSwatch,
  dragPointer,
  expectClose,
  gotoBoard,
  noteIdAtPoint,
  noteRect,
  noteTextMetrics,
  readCamera,
  setCamera,
  setCameraFarAway,
  waitForNoteCount,
} from './helpers/board';

/**
 * Story 2 in a real browser: notes are created where the pointer is, dragged with the
 * grabbed point under the cursor at any zoom, recoloured, deleted, and long text is
 * fitted by shrinking the font until it hits the readable minimum, then clipped.
 */

test('workflow: brainstorm a note, move it at 50% zoom, recolour it, delete it', async ({
  page,
}) => {
  await gotoBoard(page);

  // TC-30: a real double-click on empty board space creates a note centred on that
  // point, and whatever is typed next goes straight into it.
  await page.mouse.dblclick(400, 300);
  await page.keyboard.insertText('Hello');
  const [idea] = await waitForNoteCount(page, 1);
  expect(idea.type).toBe('sticky');
  expect(idea.color).toBe('yellow');
  expect(idea.text).toBe('Hello');
  expect(idea.z).toBe(1);
  const ideaAtFirst = await noteRect(page, idea.id);
  expectClose(ideaAtFirst.centerX, 400);
  expectClose(ideaAtFirst.centerY, 300);
  expectClose(ideaAtFirst.width, STICKY_SIZE_WORLD);
  expectClose(ideaAtFirst.height, STICKY_SIZE_WORLD);

  // A second note, through the toolbar button, and its text.
  await clickStickyNoteButton(page);
  const two = await waitForNoteCount(page, 2);
  const second = two.find((note) => note.id !== idea.id);
  if (!second) throw new Error('the Sticky note button created no note');
  await page.keyboard.insertText('Second idea');
  await page.keyboard.press('Escape'); // keep it selected, stop editing
  const positioned = await boardNotes(page);
  const secondSoFar = positioned.find((note) => note.id === second.id);
  expect(secondSoFar?.text).toBe('Second idea');
  expect(secondSoFar?.z).toBe(2);

  // TC-31: at 50% zoom, dragging by (100, 50) screen pixels moves the note by
  // (200, 100) board units and keeps the grabbed point under the pointer.
  const cameraBeforeZoom = await readCamera(page);
  await setCamera(page, { ...cameraBeforeZoom, zoom: 0.5 });
  const beforeMove = (await boardNotes(page)).find((note) => note.id === idea.id);
  if (!beforeMove) throw new Error('the first note disappeared');
  const rectBefore = await noteRect(page, idea.id);
  const grab = { x: Math.round(rectBefore.x + 40), y: Math.round(rectBefore.y + 30) };
  await dragPointer(page, grab, { x: grab.x + 100, y: grab.y + 50 });

  const afterMove = (await boardNotes(page)).find((note) => note.id === idea.id);
  if (!afterMove) throw new Error('the note vanished while it was being dragged');
  expectClose(afterMove.x - beforeMove.x, 200, 1);
  expectClose(afterMove.y - beforeMove.y, 100, 1);
  const rectAfter = await noteRect(page, idea.id);
  expectClose(rectAfter.x - rectBefore.x, 100);
  expectClose(rectAfter.y - rectBefore.y, 50);
  // The board itself did not move.
  expect(await readCamera(page)).toEqual({ ...cameraBeforeZoom, zoom: 0.5 });

  // Recolour the dragged note through its toolbar: only the colour changes.
  await clickSwatch(page, 'Green');
  const recoloured = (await boardNotes(page)).find((note) => note.id === idea.id);
  expect(recoloured?.color).toBe('green');
  expectClose(recoloured?.x ?? 0, afterMove.x, 1);
  await expect(page.locator(`[data-note-id="${idea.id}"]`)).toHaveCSS(
    'background-color',
    'rgb(197, 225, 165)',
  );

  // Delete it with the keyboard; the other note is untouched.
  await page.keyboard.press('Delete');
  const remaining = await waitForNoteCount(page, 1);
  expect(remaining.map((note) => note.id)).toEqual([second.id]);
  expect(remaining[0]?.text).toBe('Second idea');
  expect(remaining[0]?.color).toBe('yellow');
  expectClose(remaining[0]?.x ?? 0, secondSoFar?.x ?? 0, 0.5);
  expectClose(remaining[0]?.y ?? 0, secondSoFar?.y ?? 0, 0.5);
});

test('TC-32: at 200% zoom a dragged note moves by 50x25 board units and is drawn above the note it overlaps', async ({
  page,
}) => {
  await gotoBoard(page);
  const camera = await readCamera(page);
  await setCamera(page, { ...camera, zoom: 2 });

  // The lower note, then a second one on top of it, partly overlapping.
  await page.mouse.dblclick(400, 300);
  await page.keyboard.press('Escape');
  await clickStickyNoteButton(page);
  await page.keyboard.press('Escape');
  const [lower, upper] = await waitForNoteCount(page, 2);
  const lowerRect = await noteRect(page, lower.id);
  const upperRect = await noteRect(page, upper.id);
  expect(lower.z).toBeLessThan(upper.z);
  // They really do overlap.
  expect(Math.min(lowerRect.x + lowerRect.width, upperRect.x + upperRect.width)).toBeGreaterThan(
    Math.max(lowerRect.x, upperRect.x),
  );
  // A point in the lower note that the upper one does not cover.
  expect(await noteIdAtPoint(page, lowerRect.x + 30, lowerRect.y + 30)).toBe(lower.id);

  const before = { x: lower.x, y: lower.y };
  const grab = { x: Math.round(lowerRect.x + 30), y: Math.round(lowerRect.y + 30) };
  await dragPointer(page, grab, { x: grab.x + 100, y: grab.y + 50 });

  const notes = await boardNotes(page);
  const moved = notes.find((note) => note.id === lower.id);
  const stacked = notes.find((note) => note.id === upper.id);
  if (!moved || !stacked) throw new Error('a note vanished during the drag');
  // 100 screen pixels at 200% zoom is 50 board units.
  expectClose(moved.x - before.x, 50, 1);
  expectClose(moved.y - before.y, 25, 1);
  // The dragged note is now above the one it overlaps, both in the model and painted.
  expect(moved.z).toBeGreaterThan(stacked.z);
  const movedRect = await noteRect(page, lower.id);
  const overlapX = Math.max(movedRect.x, upperRect.x) + 10;
  const overlapY = Math.max(movedRect.y, upperRect.y) + 10;
  expect(overlapX).toBeLessThan(Math.min(movedRect.x + movedRect.width, upperRect.x + upperRect.width));
  expect(overlapY).toBeLessThan(Math.min(movedRect.y + movedRect.height, upperRect.y + upperRect.height));
  expect(await noteIdAtPoint(page, overlapX, overlapY)).toBe(lower.id);
});

test('TC-33: text shrinks to fit the note, then clips at the smallest readable size with a fade', async ({
  page,
}) => {
  await gotoBoard(page);
  await page.mouse.dblclick(VIEWPORT_CENTRE.x, VIEWPORT_CENTRE.y);
  await page.keyboard.insertText(SHORT_NOTE);
  const [note] = await waitForNoteCount(page, 1);

  // Short text keeps the largest size.
  const short = await noteTextMetrics(page, note.id);
  expect(short.fontPx).toBe(STICKY_FONT_MAX_PX);
  expect(short.faded).toBe(false);
  expect(short.scrollHeight).toBeLessThanOrEqual(short.clientHeight);

  // Paste 1,000 characters of prose: the note keeps exactly the limit and the text
  // gets smaller until it hits the minimum, after which it is clipped with a fade.
  await page.keyboard.insertText(` ${PROSE_1000}`);
  await expect
    .poll(async () => (await boardNotes(page))[0]?.text.length, { timeout: 10_000 })
    .toBe(STICKY_TEXT_MAX_CHARS);

  const long = await noteTextMetrics(page, note.id);
  expect(long.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(long.fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
  expect(long.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
  // Clipped inside the note, with the fade at the bottom edge.
  expect(long.scrollHeight).toBeGreaterThan(long.clientHeight);
  expect(long.overflowY).toBe('hidden');
  expect(long.faded).toBe(true);
  expect(long.fadeClass).toBe(true);

  // Nothing is drawn outside the note: the box itself never grew.
  const rect = await noteRect(page, note.id);
  expectClose(rect.width, STICKY_SIZE_WORLD);
  expectClose(rect.height, STICKY_SIZE_WORLD);

  // The counter appears as the limit is reached, and shows the limit itself.
  await expect(page.locator('[data-testid="sticky-counter"]')).toHaveText(
    `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
  );
});

test('TC-34: the Sticky note button creates a note in the middle of the screen, however far the board has been panned', async ({
  page,
}) => {
  await gotoBoard(page);
  await setCameraFarAway(page, 1);

  await clickStickyNoteButton(page);
  const [note] = await waitForNoteCount(page, 1);

  const rect = await noteRect(page, note.id);
  expectClose(rect.centerX, VIEWPORT_CENTRE.x);
  expectClose(rect.centerY, VIEWPORT_CENTRE.y);
  // It is ready for typing straight away.
  await page.keyboard.insertText('still here');
  await expect
    .poll(async () => ((await boardNotes(page))[0]?.text ?? ''), { timeout: 10_000 })
    .toBe('still here');
});
