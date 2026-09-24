/**
 * Story 2 · task 8 — end-to-end sticky-note workflows (TC-30 … TC-34), run in
 * Chromium, Firefox and WebKit against the built app.
 *
 * These are the pixel/interaction truths the design reserves for e2e: real
 * double-clicks, drags at non-unit zoom, recolouring and deletion. Geometry is
 * read from the rendered page (bounding boxes, world stamps, computed font
 * size, top-most element under a point); the ±1 px tolerance is the design's.
 */
import { expect, test } from '@playwright/test';
import { getCamera, setCamera } from './helpers/board';
import { LONG_TEXT } from '../fixtures/texts';
import {
  backgroundColorOf,
  createNoteAt,
  displayTextOf,
  expectClose,
  fontSizeOf,
  readNotes,
  settle,
  topNoteIdAt,
} from './helpers/sticky';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX } from '../../src/shared/config';

/** Drag a note from a screen point by a screen delta (button held). */
async function dragBy(page: import('@playwright/test').Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

async function noteCount(page: import('@playwright/test').Page): Promise<number> {
  return (await readNotes(page)).length;
}

test('TC-30 golden path: double-click → type → recolour → delete', async ({ page }) => {
  await page.goto('/');
  await settle(page);

  // A real double-click on empty board creates a note centred under the
  // cursor and immediately opens the editor focused with the caret at the end.
  await createNoteAt(page, 400, 300);
  await page.keyboard.type('Hello');

  // Leave editing so the note renders read-mode text.
  await page.keyboard.press('Escape');
  await settle(page);

  const notes = await readNotes(page);
  expect(notes).toHaveLength(1);
  const note = notes[0];

  // Centred at (400,300) within 1px (bisection converges to 0.5px), ± a
  // screenshot rounding pixel.
  expectClose(note.cx, 400, 1.5);
  expectClose(note.cy, 300, 1.5);

  // The typed text made it into the shared document and is shown read-mode.
  expect(await displayTextOf(page, note.id)).toBe('Hello');

  // Recolour via the Pink swatch (the note is still selected → toolbar shown).
  const yellowBefore = await backgroundColorOf(page, note.id);
  await page.getByRole('button', { name: 'Pink colour' }).click();
  await settle(page);
  const pinkAfter = await backgroundColorOf(page, note.id);
  expect(pinkAfter).not.toBe(yellowBefore);

  // Delete the selected note with the keyboard.
  await page.keyboard.press('Delete');
  await settle(page);
  expect(await noteCount(page)).toBe(0);
});

test('TC-31: at 50% zoom a (100,50) drag keeps the grabbed point under the pointer', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
  // A note somewhere in the middle of the screen at 50% zoom.
  await createNoteAt(page, 640, 400);
  await page.keyboard.press('Escape');
  await settle(page);

  const before = (await readNotes(page))[0];
  expect(before).toBeTruthy();
  const cameraBefore = await getCamera(page);

  // Grab the note near its centre and drag the pointer by (100, 50).
  const grab = { x: before.cx, y: before.cy };
  await dragBy(page, grab, 100, 50);

  const after = (await readNotes(page))[0];

  // The whole note translated with the pointer, so the grabbed point stayed
  // under it: the box moved by exactly (100, 50) on screen.
  expectClose(after.cx - before.cx, 100, 1.5);
  expectClose(after.cy - before.cy, 50, 1.5);

  // And in world units the delta is the screen delta divided by zoom (0.5).
  expectClose(after.wx - before.wx, 200, 1.5);
  expectClose(after.wy - before.wy, 100, 1.5);

  // The board itself did not pan.
  expect(await getCamera(page)).toEqual(cameraBefore);
});

test('TC-32: at 200% zoom a (100,50) drag moves world (+50,+25) and raises the note', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  await setCamera(page, { x: 0, y: 0, zoom: 2 });

  // Two notes that overlap; the second is drawn on top.
  await createNoteAt(page, 400, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 700, 500);
  await page.keyboard.press('Escape');
  await settle(page);

  const overlap = { x: 550, y: 400 }; // inside both notes
  const topBefore = await topNoteIdAt(page, overlap.x, overlap.y);
  const before = await readNotes(page);
  expect(before).toHaveLength(2);
  // The dragged note is the one under our grab point (its non-overlapped left).
  const grabbed = before.find((n) => 250 >= n.left && 250 <= n.left + n.width && 150 >= n.top && 150 <= n.top + n.height);
  expect(grabbed).toBeTruthy();
  const other = before.find((n) => n.id !== grabbed!.id);
  expect(topBefore).toBe(other!.id); // the untouched note is on top

  // Grab the lower note in its exposed left edge and drag right/down.
  await dragBy(page, { x: 250, y: 150 }, 100, 50);

  const after = await readNotes(page);
  const moved = after.find((n) => n.id === grabbed!.id)!;
  const stillOther = after.find((n) => n.id === other!.id)!;

  // World delta at 200%: screen (100,50) → (+50,+25).
  expectClose(moved.wx - grabbed!.wx, 50, 1.5);
  expectClose(moved.wy - grabbed!.wy, 25, 1.5);

  // The dragged note now overlaps the other and is painted above it.
  expect(moved.cx).toBeGreaterThan(400); // it moved right into the overlap
  expect(await topNoteIdAt(page, 600, 420)).toBe(moved.id);
  // And in paint order it is now last (top-most).
  expect(after[after.length - 1].id).toBe(moved.id);
  expect(stillOther.id).not.toBe(moved.id);
});

test('TC-33: long text shrinks to fit then fades, and nothing overflows the note', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  // A short note renders at the maximum font size.
  await createNoteAt(page, 300, 300);
  await page.keyboard.type('Idea');
  await page.keyboard.press('Escape');
  await settle(page);
  const [shortNote] = await readNotes(page);
  expect(await fontSizeOf(page, shortNote.id, 'display')).toBeCloseTo(24, 0);

  // Paste a 1,000-char prose fixture into a second note (one insert, like a
  // real paste).
  expect(LONG_TEXT.length).toBe(1000);
  await createNoteAt(page, 900, 500);
  await page.keyboard.insertText(LONG_TEXT);
  await page.keyboard.press('Escape');
  await settle(page);

  const notes = await readNotes(page);
  const longNote = notes.find((n) => n.cx > 700)!;
  expect(longNote).toBeTruthy();

  const font = await fontSizeOf(page, longNote.id, 'display');
  // It shrank from 24 but never below the minimum, and the overflow fade is on.
  expect(font).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(font).toBeLessThan(STICKY_FONT_MAX_PX);

  const fade = await page
    .locator(`[data-note-id="${longNote.id}"] .sticky-content`)
    .first()
    .evaluate((node) => ({
      faded: node.classList.contains('text-overflow-fade'),
      overflow: getComputedStyle(node).overflow,
      scrollOverflow: node.scrollHeight > node.clientHeight + 1,
    }));
  // There genuinely is more text than fits (so the fade is meaningful) ...
  expect(fade.scrollOverflow).toBe(true);
  // ... it is clipped inside the box (nothing drawn outside), ...
  expect(fade.overflow).toBe('hidden');
  // ... and the fade marker class is applied.
  expect(fade.faded).toBe(true);
});

test('TC-34: the Sticky note button creates a centred note even when panned far away', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  // Jump the camera a long way from the origin (test-only hook).
  await setCamera(page, { x: 12345, y: -9876, zoom: 1 });

  await page.getByRole('button', { name: 'Sticky note' }).click();
  await settle(page);

  const notes = await readNotes(page);
  expect(notes).toHaveLength(1);
  const note = notes[0];

  // It appears at the centre of the visible board area (640,400), not at the
  // world origin — proving the create maps through the current camera.
  expectClose(note.cx, 640, 2);
  expectClose(note.cy, 400, 2);
  expect(Math.abs(note.wx)).toBeGreaterThan(1000);
  expect(note.editing).toBe(true);
});