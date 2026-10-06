/**
 * sticky.interaction / sticky.toolbar e2e tests: making notes, selecting them,
 * recolouring and removing them, in a real browser.
 *
 * TC-28 (create at the view centre), TC-29 (bin), TC-30 (double-click to create),
 * TC-25 (Delete / Backspace), TC-27 (colours), TC-35, TC-36.
 * Dragging is in sticky-move.spec.ts, text and font fitting in sticky-text.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';
import { getCamera, setCamera } from './helpers/board';
import { navigateToNewBoard } from './helpers/navigate';
import {
  cssColor,
  doubleClickToCreate,
  editorOf,
  getNotes,
  noteBackgroundColor,
  noteCentre,
  noteCount,
  noteLocator,
  noteWorld,
  stopEditing,
  typeIntoEditor,
  worldOfScreen,
} from './helpers/notes';
import { DEFAULT_STICKY_COLOR, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_NOTE } from '../fixtures/texts';

const CENTRE = { x: 640, y: 400 };
/** The point the design double-clicks in TC-30; empty board space on the first screen. */
const SPOT = { x: 400, y: 300 };
/** Another empty spot, clear of both. */
const AWAY = { x: 1050, y: 650 };

/** Creates a note with the left toolbar button and leaves its text empty. */
async function createAtCentre(page: Page): Promise<void> {
  await page.getByTestId('create-sticky-button').click();
  await expect(editorOf(page)).toBeVisible();
  await stopEditing(page);
}

/** Selects a note with a single click and returns its centre. */
async function clickNote(page: Page, index = 0): Promise<{ x: number; y: number }> {
  const centre = await noteCentre(page, index);
  await page.mouse.click(centre.x, centre.y);
  return centre;
}

test.describe('creating notes', () => {
  test('TC-30 double-clicking empty board space creates a note there and typing fills it', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await doubleClickToCreate(page, SPOT);

    await expect(page.getByTestId('sticky-note-input')).toBeVisible();
    expect(await noteCount(page)).toBe(1);

    // the note is centred on the point that was double-clicked, within a pixel
    const spotWorld = await worldOfScreen(page, SPOT);
    const position = await noteWorld(page, 0);
    expect(position.x).toBeCloseTo(spotWorld.x - STICKY_SIZE_WORLD / 2, 6);
    expect(position.y).toBeCloseTo(spotWorld.y - STICKY_SIZE_WORLD / 2, 6);
    const centre = await noteCentre(page, 0);
    expect(Math.abs(centre.x - SPOT.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - SPOT.y)).toBeLessThanOrEqual(1);

    // the caret is in the note: the characters the user types go straight into the text
    await typeIntoEditor(page, 'Hello');
    await stopEditing(page);
    expect((await getNotes(page))[0]?.text).toBe('Hello');
    await expect(noteLocator(page, 0)).toHaveText('Hello');
  });

  test('TC-28 the Sticky note button creates one note in the middle of the view', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await page.getByTestId('create-sticky-button').click();

    expect(await noteCount(page)).toBe(1);
    const centre = await noteCentre(page, 0);
    expect(Math.abs(centre.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - CENTRE.y)).toBeLessThanOrEqual(1);
    // the text editor is open, so the user can type straight away
    await expect(page.getByTestId('sticky-note-input')).toBeVisible();
    await expect(page.getByTestId('create-sticky-button')).toHaveAttribute(
      'title',
      'Sticky note – or double-click the board',
    );
  });

  test('TC-34 creating from far away in the board still lands in the middle of the screen', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    // pan tens of thousands of world units away from the origin, through the test hook
    const panned = { x: 52_000, y: -31_500, zoom: 1 };
    await setCamera(page, panned);
    expect(await getCamera(page)).toEqual(panned);

    await page.getByTestId('create-sticky-button').click();
    await stopEditing(page);

    expect(await noteCount(page)).toBe(1);
    const centre = await noteCentre(page, 0);
    expect(Math.abs(centre.x - CENTRE.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - CENTRE.y)).toBeLessThanOrEqual(1);
    // the note sits where the user was looking, not at the origin
    const position = await noteWorld(page, 0);
    expect(position.x).toBeCloseTo(panned.x + CENTRE.x - STICKY_SIZE_WORLD / 2, 6);
  });

  test('creating notes one after another makes separate notes', async ({ page }) => {
    await navigateToNewBoard(page);
    for (const text of ['one', 'two', 'three']) {
      await page.getByTestId('create-sticky-button').click();
      await expect(page.getByTestId('sticky-note-input')).toBeVisible();
      await typeIntoEditor(page, text);
      await stopEditing(page);
    }

    const notes = await getNotes(page);
    expect(notes.map((note) => note.text)).toEqual(['one', 'two', 'three']);
    // all three were created at the centre of the view, so they overlap exactly
    for (const note of notes) {
      expect(note.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
      expect(note.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2, 6);
    }
    // and the newest one is on top, ready to type into
    expect(notes[2]?.z).toBeGreaterThan(notes[0]?.z ?? 0);
  });

  test('deselecting and then double-clicking empty space creates exactly one more note', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);

    await clickNote(page, 0);
    await expect(noteLocator(page, 0)).toHaveAttribute('data-selected', 'true');
    await page.mouse.click(AWAY.x, AWAY.y);
    await expect(noteLocator(page, 0)).not.toHaveAttribute('data-selected');

    await doubleClickToCreate(page, SPOT);
    await stopEditing(page);

    expect(await noteCount(page)).toBe(2);
    const position = await noteWorld(page, 1);
    const spotWorld = await worldOfScreen(page, SPOT);
    expect(position.x).toBeCloseTo(spotWorld.x - STICKY_SIZE_WORLD / 2, 6);
  });

  test('TC-35 double-clicking a note edits it instead of creating another one', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);
    const centre = await clickNote(page, 0);

    await page.mouse.dblclick(centre.x, centre.y);

    expect(await noteCount(page)).toBe(1);
    await expect(page.getByTestId('sticky-note-input')).toBeVisible();
  });

  test('TC-36 Enter with nothing selected creates and edits nothing', async ({ page }) => {
    await navigateToNewBoard(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    expect(await noteCount(page)).toBe(0);
    await expect(page.getByTestId('sticky-note-input')).toHaveCount(0);
    expect(await getCamera(page)).toEqual({ x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
  });
});

test.describe('recolouring and deleting', () => {
  test('TC-27 the colour swatches recolour the note and change nothing else', async ({ page }) => {
    await navigateToNewBoard(page);
    await doubleClickToCreate(page, SPOT);
    await typeIntoEditor(page, SHORT_NOTE);
    await stopEditing(page);
    const before = (await getNotes(page))[0];
    expect(before?.color).toBe(DEFAULT_STICKY_COLOR);
    expect(await noteBackgroundColor(page, 0)).toBe(cssColor(STICKY_COLORS[DEFAULT_STICKY_COLOR]));

    await page.getByLabel('Pink colour').click();

    const after = (await getNotes(page))[0];
    expect(after?.color).toBe('pink');
    expect(await noteBackgroundColor(page, 0)).toBe(cssColor(STICKY_COLORS.pink));
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
    expect(after?.z).toBe(before?.z);
    expect(after?.text).toBe(SHORT_NOTE);
    await expect(noteLocator(page, 0)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByLabel('Pink colour')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-29 the bin removes the note', async ({ page }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);

    await page.getByTestId('note-delete').click();

    expect(await noteCount(page)).toBe(0);
    await expect(page.locator('[data-note-id]')).toHaveCount(0);
  });

  test('TC-25 a selected note is removed by Delete', async ({ page }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);
    expect(await noteCount(page)).toBe(1);

    await page.keyboard.press('Delete');

    expect(await noteCount(page)).toBe(0);
  });

  test('TC-25 a selected note is removed by Backspace', async ({ page }) => {
    await navigateToNewBoard(page);
    await createAtCentre(page);
    expect(await noteCount(page)).toBe(1);

    await page.keyboard.press('Backspace');

    expect(await noteCount(page)).toBe(0);
  });

  test('TC-37 a note deleted while it is being dragged ends the drag quietly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await navigateToNewBoard(page);
    await createAtCentre(page);
    const centre = await noteCentre(page, 0);

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 90, centre.y + 60, { steps: 5 });
    // the note is deleted from under the still-pressed pointer (keyboard delete of the
    // selection - in story 3 it would arrive from another user)
    await page.keyboard.press('Delete');
    await page.mouse.move(centre.x + 200, centre.y + 150, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    expect(await noteCount(page)).toBe(0); // removed, and not re-created
    expect(errors).toEqual([]);
  });
});
