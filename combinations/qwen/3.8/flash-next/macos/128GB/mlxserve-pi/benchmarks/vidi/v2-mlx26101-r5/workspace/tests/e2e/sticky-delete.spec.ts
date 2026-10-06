import { expect, test } from '@playwright/test';

import { DEFAULT_STICKY_COLOR, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_PHRASE } from '../fixtures/texts';
import {
  VIEWPORT,
  clickNote,
  doubleClickCreate,
  editorLocator,
  editorValue,
  expectNoteCount,
  hasTestId,
  note,
  noteIds,
  noteInteraction,
  noteScreenBox,
  noteText,
  noteWorld,
  openBoard,
  readCamera,
  setCamera,
  settled,
  toolbarCreate,
} from './helpers/board';

const CENTRE = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/**
 * Presses Tab until this note's own element has focus and returns the number of
 * stops it took. The note is `tabindex=0`, so it is reachable; the loop is bounded
 * by one turn of the page's focus ring, which after an edit is: the note, its six
 * colours and its delete button, the two tool buttons and the Sticky note button
 * that the toolbar leads with, undo, the four stops of the zoom control, the share
 * button, and the page itself — seventeen before the note comes round again. The
 * body is a stop in some browsers and not in others, and the bound is deliberately
 * a little wider than the count: the promise being tested is that a note is
 * reachable by Tab at all, not how many stops the chrome in front of it happens to
 * be worth.
 */
async function tabUntilNoteFocused(page: Parameters<typeof note>[0], id: string): Promise<number> {
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.dataset['noteId'] ?? null;
    });
  let stops = 0;
  while ((await focused()) !== id && stops < 24) {
    await page.keyboard.press('Tab');
    stops += 1;
  }
  expect(await focused()).toBe(id);
  return stops;
}

test.describe('deleting and recolouring sticky notes', () => {
  // TC-34: far from the origin, the toolbar button still puts a note on screen
  test('after panning far away, the Sticky note button creates a note at the screen centre', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 200000, y: -160000 });
    const camera = await readCamera(page);
    expect(Math.abs(camera.x)).toBeGreaterThan(1000);

    const id = await toolbarCreate(page);

    // The note is centred on the middle of the screen, so the author sees it.
    const box = await noteScreenBox(page, id);
    expect(box.cx).toBeCloseTo(CENTRE.x, 0);
    expect(box.cy).toBeCloseTo(CENTRE.y, 0);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 0);
    // Its world position is the world point under the screen centre.
    const world = await noteWorld(page, id);
    expect(world.x).toBeCloseTo(camera.x + CENTRE.x - STICKY_SIZE_WORLD / 2, 1);
    expect(world.y).toBeCloseTo(camera.y + CENTRE.y - STICKY_SIZE_WORLD / 2, 1);
    await expect(editorLocator(page)).toBeFocused();
  });

  // TC-34 with the bin button
  test('the bin button deletes the selected note and nothing else', async ({ page }) => {
    await openBoard(page);
    const first = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('first');
    await page.keyboard.press('Escape');
    const second = await doubleClickCreate(page, 900, 500);
    await page.keyboard.type('second');
    await page.keyboard.press('Escape');
    const firstBefore = await noteWorld(page, first);

    await clickNote(page, second);
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    await page.getByTestId('delete-note').click();

    expect(await noteIds(page)).toEqual([first]);
    await expect(note(page, second)).toHaveCount(0);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
    // The other note kept its text, position and colour.
    expect(await noteText(page, first)).toBe('first');
    expect(await noteWorld(page, first)).toEqual(firstBefore);
    expect(await note(page, first).getAttribute('data-color')).toBe(DEFAULT_STICKY_COLOR);
  });

  // TC-25 / TC-34 with the keyboard
  test('Delete and Backspace remove the selected note, and only that note', async ({ page }) => {
    await openBoard(page);
    const a = await doubleClickCreate(page, 300, 300);
    await page.keyboard.press('Escape');
    const b = await doubleClickCreate(page, 640, 620);
    await page.keyboard.press('Escape');

    await clickNote(page, a);
    await page.keyboard.press('Delete');
    expect(await noteIds(page)).toEqual([b]);

    await page.mouse.click(1100, 120); // empty board space: nothing selected
    await clickNote(page, b);
    await page.keyboard.press('Backspace');
    await expectNoteCount(page, 0);

    // With nothing left to delete the board still works.
    const again = await toolbarCreate(page);
    await page.keyboard.type('again');
    await page.keyboard.press('Escape');
    expect(await noteText(page, again)).toBe('again');
  });

  // The keyboard shortcuts stay out of the way while typing
  test('Backspace and Delete edit text while a note is being edited', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('abc');
    await settled(page);
    expect(await editorValue(page)).toBe('abc');

    // Backspace removes one character of text; the note survives.
    await page.keyboard.press('Backspace');
    await settled(page);
    expect(await editorValue(page)).toBe('ab');
    await expectNoteCount(page, 1);
    await expect(editorLocator(page)).toBeFocused();

    // Delete with nothing selected removes nothing.
    await page.keyboard.press('Delete');
    await settled(page);
    expect(await editorValue(page)).toBe('ab');
    await expectNoteCount(page, 1);

    // Enter writes a newline instead of creating or deleting a note.
    await page.keyboard.press('Enter');
    await settled(page);
    expect(await editorValue(page)).toBe('ab\n');
    await expectNoteCount(page, 1);

    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe('ab\n');
  });

  // Enter starts editing the selected note; with nothing selected it does nothing
  test('Enter edits the selected note and creates nothing when nothing is selected', async ({
    page,
  }) => {
    await openBoard(page);
    await page.keyboard.press('Enter');
    await expectNoteCount(page, 0);

    const id = await toolbarCreate(page);
    await page.keyboard.press('Escape'); // selected, not editing
    expect(await noteInteraction(page, id)).toBe('selected');

    await page.keyboard.press('Enter');
    await expect(editorLocator(page)).toBeFocused();
    await expectNoteCount(page, 1);
    expect(await noteInteraction(page, id)).toBe('editing');
  });

  // TC-27: a swatch repaints the note and nothing else about it
  test('a colour swatch changes only the colour', async ({ page }) => {
    await openBoard(page);
    const a = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type(SHORT_PHRASE);
    await page.keyboard.press('Escape');
    const b = await doubleClickCreate(page, 900, 300);
    await page.keyboard.press('Escape');
    const aBefore = await noteWorld(page, a);
    const bBefore = await noteWorld(page, b);
    const camera = await readCamera(page);

    await clickNote(page, a);
    await page.getByTestId('color-pink').click();

    expect(await note(page, a).getAttribute('data-color')).toBe('pink');
    expect(await noteWorld(page, a)).toEqual(aBefore); // position and z untouched
    expect(await noteText(page, a)).toBe(SHORT_PHRASE);
    expect(await noteInteraction(page, a)).toBe('selected');
    // The other note is untouched, and so is the camera.
    expect(await note(page, b).getAttribute('data-color')).toBe(DEFAULT_STICKY_COLOR);
    expect(await noteWorld(page, b)).toEqual(bBefore);
    expect(await readCamera(page)).toEqual(camera);
  });

  // The controls are named, and only the current colour reads as pressed
  test('names every toolbar control and marks the current colour', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: 'Sticky note' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Board tools' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Note toolbar' })).toBeVisible();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      await expect(page.getByRole('button', { name: `${name} colour` })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Delete note' })).toBeVisible();
    expect(await page.getByTestId(`color-${DEFAULT_STICKY_COLOR}`).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(await hasTestId(page, 'sticky-counter')).toBe(false);

    await page.getByTestId('color-violet').click();
    expect(await page.getByTestId('color-violet').getAttribute('aria-pressed')).toBe('true');
    expect(await page.getByTestId('color-pink').getAttribute('aria-pressed')).toBe('false');
    expect(await note(page, id).getAttribute('data-color')).toBe('violet');
  });

  // The PRD asks for notes reachable with Tab and editable with Enter
  test('Tab reaches a note and Enter edits it without the mouse touching it', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.type('tabbed');
    await page.keyboard.press('Escape');
    // Nothing is selected: keyboard-only use has to work from focus alone.
    await page.mouse.click(900, 620);
    expect(await noteInteraction(page, id)).toBe('unselected');

    await tabUntilNoteFocused(page, id);
    await page.keyboard.press('Enter');
    await expect(editorLocator(page)).toBeFocused();
    expect(await editorValue(page)).toBe('tabbed');
    expect(await noteInteraction(page, id)).toBe('editing');
    await page.keyboard.press('Escape');
    expect(await noteText(page, id)).toBe('tabbed');

    // And the same way in: the focused note is the note Delete removes.
    await tabUntilNoteFocused(page, id);
    await page.keyboard.press('Delete');
    await expectNoteCount(page, 0);
  });

  // The note toolbar hides while the note is dragged or edited
  test('hides the note toolbar while dragging and while editing', async ({ page }) => {
    await openBoard(page);
    const id = await doubleClickCreate(page, 400, 300);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('note-toolbar')).toBeVisible();

    const box = await noteScreenBox(page, id);
    await page.mouse.move(box.cx, box.cy);
    await page.mouse.down();
    await page.mouse.move(box.cx + 40, box.cy + 20, { steps: 3 });
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);
    await page.mouse.up();
    await expect(page.getByTestId('note-toolbar')).toBeVisible();

    // Double-click the note where it now is: editing hides the toolbar too.
    await page.mouse.dblclick(box.cx + 40, box.cy + 20);
    await expect(editorLocator(page)).toBeFocused();
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);
  });
});
