import { expect, test } from '@playwright/test';
import { getCamera, openBoard, setCamera, expectNear } from './helpers/board';
import {
  clickEmptyBoard,
  createStickyButton,
  deleteNoteButton,
  dragNoteBy,
  doubleClickToCreate,
  editor,
  noteAt,
  noteFontSize,
  noteText,
  noteWithText,
  notes,
  noteById,
  stateOf,
  swatch,
  textIsClippedInsideNote,
  topmostNoteAt,
  typeText,
} from './helpers/sticky';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_PARAGRAPH_1000 } from '../fixtures/texts';

test.describe('sticky notes (story 2)', () => {
  test('TC-30 double-click creates a centred, editable note', async ({ page }) => {
    await openBoard(page);

    await doubleClickToCreate(page, 400, 300);
    await typeText(page, 'Hello');

    const state = await stateOf(noteAt(page, 0));
    expectNear(state.box.x + state.box.width / 2, 400);
    expectNear(state.box.y + state.box.height / 2, 300);
    expect(state.box.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(state.text).toBe('Hello');
    expect(state.color).toBe('yellow');

    await clickEmptyBoard(page);
    await expect(notes(page)).toHaveCount(1);
    await expect(noteText(page, 0)).toHaveText('Hello');
    expect((await stateOf(noteAt(page, 0))).selected).toBe('false');
  });

  test('TC-31 dragging at 50% zoom keeps the grabbed point under the pointer', async ({
    page,
  }) => {
    await openBoard(page);
    await doubleClickToCreate(page, 500, 400);
    await clickEmptyBoard(page);

    await setCamera(page, { zoom: 0.5 });
    expect(await getCamera(page)).toMatchObject({ zoom: 0.5 });

    const before = await stateOf(noteAt(page, 0));
    const grab = { x: 30, y: 20 };
    const delta = { x: 100, y: 50 };
    await dragNoteBy(noteAt(page, 0), grab, delta);

    const after = await stateOf(noteAt(page, 0));
    // the grabbed screen point moved by exactly the pointer delta
    expectNear(after.box.x + grab.x, before.box.x + grab.x + delta.x);
    expectNear(after.box.y + grab.y, before.box.y + grab.y + delta.y);
    // 50% zoom: 100 x 50 screen pixels are 200 x 100 world units
    expectNear(after.world.x - before.world.x, 200, 0.5);
    expectNear(after.world.y - before.world.y, 100, 0.5);
  });

  test('TC-32 dragging at 200% zoom moves half as far and raises the note', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { zoom: 2 });

    // two overlapping notes; the second is created on top
    await doubleClickToCreate(page, 400, 300);
    await clickEmptyBoard(page);
    await doubleClickToCreate(page, 700, 300);
    await clickEmptyBoard(page);
    expect(await notes(page)).toHaveCount(2);

    const overlap = { x: 550, y: 300 };
    const lower = await stateOf(noteAt(page, 0));
    const upper = await stateOf(noteAt(page, 1));
    expect(upper.z).toBeGreaterThan(lower.z);
    const topBefore = await topmostNoteAt(page, overlap);
    expect(topBefore?.z).toBe(upper.z);

    // drag the note that was below across the other one
    const dragged = noteById(page, lower.id);
    await dragNoteBy(dragged, { x: 60, y: 100 }, { x: 100, y: 50 });

    const moved = await stateOf(dragged);
    // 200% zoom: 100 x 50 screen pixels are 50 x 25 world units
    expectNear(moved.world.x - lower.world.x, 50, 0.5);
    expectNear(moved.world.y - lower.world.y, 25, 0.5);

    // it is now drawn above the note it overlaps
    const topAfter = await topmostNoteAt(page, overlap);
    expect(topAfter?.z).toBe(moved.z);
    expect(topAfter?.z).toBeGreaterThan(upper.z);
    expect(topAfter?.x).toBeCloseTo(moved.world.x, 3);
  });

  test('TC-33 short text renders at the largest size, long text clips with a fade', async ({
    page,
  }) => {
    await openBoard(page);

    await doubleClickToCreate(page, 640, 400);
    await typeText(page, 'Onboarding');
    expect(await noteFontSize(page, 0)).toBeCloseTo(STICKY_FONT_MAX_PX, 1);

    // paste a whole paragraph: the text shrinks, and at the minimum size it
    // clips with a fade instead of spilling outside the note
    await page.keyboard.insertText(` ${LONG_PARAGRAPH_1000}`);
    await page.waitForTimeout(100);

    const size = await noteFontSize(page, 0);
    expect(size).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(size).toBeLessThan(STICKY_FONT_MAX_PX);

    await clickEmptyBoard(page);
    await expect(noteText(page, 0)).toHaveClass(/fade-bottom/);
    expect(await textIsClippedInsideNote(page, 0)).toBe(true);
    const kept = await noteText(page, 0).textContent();
    expect(kept?.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
  });

  test('TC-34 the toolbar button creates a note at the viewport centre, far from the origin', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 250_000, y: -175_000 });

    await createStickyButton(page).click();
    await expect(editor(page)).toBeVisible();

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport size');
    const state = await stateOf(noteAt(page, 0));
    expectNear(state.box.x + state.box.width / 2, viewport.width / 2);
    expectNear(state.box.y + state.box.height / 2, viewport.height / 2);
    expect(state.box.width).toBeGreaterThan(0);

    await typeText(page, 'Idea');
    await clickEmptyBoard(page);
    await expect(noteText(page, 0)).toHaveText('Idea');
  });

  test('workflow: brainstorm, move, recolour and delete notes', async ({ page }) => {
    await openBoard(page);

    await doubleClickToCreate(page, 420, 300);
    await typeText(page, 'Faster onboarding');
    await clickEmptyBoard(page);
    await doubleClickToCreate(page, 760, 320);
    await typeText(page, 'Duplicate idea');
    await clickEmptyBoard(page);
    expect(await notes(page)).toHaveCount(2);

    // moved away from its neighbour, at 50% zoom
    await setCamera(page, { zoom: 0.5 });
    const first = noteWithText(page, 'Faster onboarding');
    const before = await stateOf(first);
    await dragNoteBy(first, { x: 25, y: 25 }, { x: -140, y: 60 });
    const moved = await stateOf(first);
    expectNear(moved.world.x - before.world.x, -280, 0.5);
    expectNear(moved.world.y - before.world.y, 120, 0.5);

    // recolour it through the floating toolbar
    await first.click();
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    await swatch(page, 'Green').click();
    await expect(first).toHaveAttribute('data-color', 'green');
    expect((await stateOf(first)).text).toBe('Faster onboarding');

    // the duplicate is still yellow
    const other = noteWithText(page, 'Duplicate idea');
    expect((await stateOf(other)).color).toBe('yellow');

    // delete the duplicate with the keyboard
    await other.click();
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(1);
    await expect(noteText(page, 0)).toHaveText('Faster onboarding');

    // and the last one through its toolbar bin button
    await noteAt(page, 0).click();
    await deleteNoteButton(page).click();
    await expect(notes(page)).toHaveCount(0);
    await expect(page.getByTestId('note-toolbar')).toHaveCount(0);
  });

  test('keyboard contract: Enter edits, Escape keeps text, Backspace types or deletes', async ({
    page,
  }) => {
    await openBoard(page);

    await doubleClickToCreate(page, 500, 300);
    await typeText(page, 'ab');
    await page.keyboard.press('Escape');
    await expect(noteText(page, 0)).toHaveText('ab');

    // Enter re-opens the editor; Backspace edits text and never deletes a note
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeVisible();
    await typeText(page, 'c');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(noteText(page, 0)).toHaveText('ab');

    // Backspace with the note selected but not editing deletes it
    await page.keyboard.press('Backspace');
    await expect(notes(page)).toHaveCount(0);
  });
});
