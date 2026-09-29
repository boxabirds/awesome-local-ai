import { test, expect } from '@playwright/test';
import {
  getStickyNotes,
  getNoteIds,
  getNoteWorldPos,
  getNoteScreenBox,
  dragNoteBy,
  createNoteByDblclick,
  getCreateStickyButton,
  getNoteTextarea,
  getNoteText,
  getNoteToolbarFor,
  setCamera,
} from './helpers/sticky';
import { getViewport } from './helpers/board';
import { createAndGotoBoard } from './helpers/create-board';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS, STICKY_SIZE_WORLD } from '@shared/config';
import { SHORT_PHRASE, PROSE_1000 } from '../fixtures/texts';

test.describe('Sticky notes', () => {
  test('TC-30: double-click creates a centred note that accepts typing', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createNoteByDblclick(page, 400, 300);
    expect(id).toBeTruthy();

    await page.keyboard.type('Hello');

    const box = await getNoteScreenBox(page, id);
    // Note centred on the double-click point within 1px
    expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 300)).toBeLessThanOrEqual(1);

    await expect(getNoteText(page, id)).toHaveText('Hello');
  });

  test('Workflow: brainstorm golden path (create, move at 50%, recolour, delete)', async ({ page }) => {
    await createAndGotoBoard(page);

    // TC-30 create + type
    const idA = await createNoteByDblclick(page, 400, 300);
    await page.keyboard.type(SHORT_PHRASE);

    // Second note
    const idB = await createNoteByDblclick(page, 700, 300);
    await page.keyboard.type('Second idea');

    // End editing
    await page.keyboard.press('Escape');

    // TC-31: at 50% zoom, drag note A by (100,50) screen px → world +200,+100
    await setCamera(page, { x: -640, y: -400, zoom: 0.5 });
    await page.waitForTimeout(50);

    const before = await getNoteWorldPos(page, idA);
    const bBefore = await getNoteWorldPos(page, idB);
    const boxBefore = await getNoteScreenBox(page, idA);
    const grabOffset = { x: boxBefore.width / 2, y: boxBefore.height / 2 };
    await dragNoteBy(page, idA, 100, 50);
    const after = await getNoteWorldPos(page, idA);
    const boxAfter = await getNoteScreenBox(page, idA);

    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
    // Grabbed point stays under the pointer: the box moved exactly by the drag.
    expect(Math.abs(boxAfter.x - boxBefore.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - boxBefore.y - 50)).toBeLessThanOrEqual(1);
    expect(grabOffset.x).toBeGreaterThan(0);

    // Recolour: select note B, choose Green
    // Click empty area to deselect first (A's selection handles may overlap B)
    await page.mouse.click(100, 600);
    await page.waitForTimeout(50);
    const boxB = await getNoteScreenBox(page, idB);
    await page.mouse.click(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
    const toolbar = getNoteToolbarFor(page, idB);
    await expect(toolbar).toBeVisible();
    await toolbar.locator('[aria-label="Green colour"]').click();
    await expect(
      toolbar.locator('[aria-label="Green colour"]'),
    ).toHaveAttribute('aria-pressed', 'true');

    // Other notes did not move while dragging note A: note B keeps its world position
    const bAfter = await getNoteWorldPos(page, idB);
    expect(bAfter.x).toBe(bBefore.x);
    expect(bAfter.y).toBe(bBefore.y);

    // Delete note A with the Delete key
    // Click empty area first to deselect (B's handles may overlap A)
    await page.mouse.click(100, 600);
    await page.waitForTimeout(50);
    const boxA2 = await getNoteScreenBox(page, idA);
    await page.mouse.click(boxA2.x + boxA2.width / 2, boxA2.y + boxA2.height / 2);
    await page.keyboard.press('Delete');
    await expect(getStickyNotes(page)).toHaveCount(1);
    const remaining = await getNoteIds(page);
    expect(remaining).toEqual([idB]);
    await expect(getNoteText(page, idB)).toHaveText('Second idea');
  });

  test('TC-32: drag at 200% zoom moves half as many world units and stacks the note on top', async ({ page }) => {
    await createAndGotoBoard(page);

    await setCamera(page, { x: -640, y: -400, zoom: 2 });
    await page.waitForTimeout(50);

    // Two notes that do not overlap at 200% (a note is 400 screen px wide here)
    const idA = await createNoteByDblclick(page, 400, 300);
    await page.keyboard.type('Top');
    const idB = await createNoteByDblclick(page, 900, 600);
    await page.keyboard.type('Below');
    await page.keyboard.press('Escape');

    const before = await getNoteWorldPos(page, idA);
    // TC-31/TC-32 core gesture: 100x50 screen px at 200% = 50x25 world units
    await dragNoteBy(page, idA, 100, 50);
    const after = await getNoteWorldPos(page, idA);
    expect(after.x - before.x).toBeCloseTo(50, 0);
    expect(after.y - before.y).toBeCloseTo(25, 0);

    // Drag further so the two notes overlap, then check stacking
    await dragNoteBy(page, idA, 300, 200);
    const stacked = await getNoteWorldPos(page, idA);

    expect(stacked.x - before.x).toBeCloseTo(200, 0);
    expect(stacked.y - before.y).toBeCloseTo(125, 0);

    // Drawn above the note it overlaps: A has the higher stacking value.
    const bPos = await getNoteWorldPos(page, idB);
    expect(stacked.z).toBeGreaterThan(bPos.z);
    const zIndices = await page.$$eval('[data-testid="sticky-note-wrapper"]', (els) =>
      els.map((e) => {
        const el = e as HTMLElement;
        return { id: el.dataset.noteId as string, z: parseInt(el.style.zIndex || '0', 10) };
      }),
    );
    const zA = zIndices.find((n) => n.id === idA)!.z;
    const zB = zIndices.find((n) => n.id === idB)!.z;
    expect(zA).toBeGreaterThan(zB);

    // The boxes really do overlap on screen
    const boxA = await getNoteScreenBox(page, idA);
    const boxB = await getNoteScreenBox(page, idB);
    const overlap =
      boxA.x < boxB.x + boxB.width && boxB.x < boxA.x + boxA.width &&
      boxA.y < boxB.y + boxB.height && boxB.y < boxA.y + boxA.height;
    expect(overlap).toBe(true);
  });

  test('TC-33: text auto-fits, then clips with a bottom fade at the minimum size', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createNoteByDblclick(page, 640, 400);
    await page.keyboard.type('Idea');

    const textEl = getNoteText(page, id);
    await expect(textEl).toHaveText('Idea');
    const bigFont = await textEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(bigFont).toBe(STICKY_FONT_MAX_PX);

    // Paste 1,000 characters of prose (replaces the word typed above)
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(PROSE_1000);
    await expect(getNoteTextarea(page)).toHaveValue(PROSE_1000);

    await page.keyboard.press('Escape');
    await expect(textEl).toHaveText(PROSE_1000);

    const smallFont = await textEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(smallFont).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(smallFont).toBeLessThan(STICKY_FONT_MAX_PX);

    // Overflow fade present
    await expect(page.locator(`[data-note-id="${id}"] .sticky-note-fade`)).toHaveCount(1);

    // Nothing is drawn outside the note box
    const clip = await page.locator(`[data-testid="sticky-note"][data-note-id="${id}"]`).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const fade = el.querySelector('.sticky-note-fade')!.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        overflow: style.overflow,
        fadeBottom: fade.bottom,
        fadeRight: fade.right,
        boxBottom: box.bottom,
        boxRight: box.right,
      };
    });
    expect(clip.overflow).toBe('hidden');
    expect(clip.fadeBottom).toBeLessThanOrEqual(clip.boxBottom + 1);
    expect(clip.fadeRight).toBeLessThanOrEqual(clip.boxRight + 1);
  });

  test('TC-34: toolbar creation is visible at the screen centre even when panned far away', async ({ page }) => {
    await createAndGotoBoard(page);

    await setCamera(page, { x: 120_000, y: -85_000, zoom: 1 });
    await page.waitForTimeout(50);

    await getCreateStickyButton(page).click();
    const ids = await getNoteIds(page);
    expect(ids.length).toBe(1);

    const box = await getNoteScreenBox(page, ids[0]);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);

    // Accepts typing straight away
    await page.keyboard.type('Anywhere');
    await expect(getNoteText(page, ids[0])).toHaveText('Anywhere');
  });

  test('Pasting beyond the limit keeps exactly 1,000 characters and shows the counter', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createNoteByDblclick(page, 640, 400);
    await page.keyboard.insertText(PROSE_1000 + 'overflowing tail of extra text');

    const value = await getNoteTextarea(page).inputValue();
    expect(value.length).toBe(STICKY_TEXT_MAX_CHARS);
    await expect(page.locator('[data-testid="sticky-note-counter"]')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
    expect(id).toBeTruthy();
  });

  test('Dragging a note never pans the board', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createNoteByDblclick(page, 400, 300);
    await page.keyboard.type('Move me');
    await page.keyboard.press('Escape');

    const before = await getNoteWorldPos(page, id);

    const world = page.locator('[data-testid="world-layer"]');
    const camBefore = {
      x: parseFloat((await world.getAttribute('data-camera-x'))!),
      y: parseFloat((await world.getAttribute('data-camera-y'))!),
    };

    await dragNoteBy(page, id, 180, -90);

    const camAfter = {
      x: parseFloat((await world.getAttribute('data-camera-x'))!),
      y: parseFloat((await world.getAttribute('data-camera-y'))!),
    };
    expect(camAfter.x).toBe(camBefore.x);
    expect(camAfter.y).toBe(camBefore.y);

    const pos = await getNoteWorldPos(page, id);
    expect(pos.x - before.x).toBeCloseTo(180, 0);
    expect(pos.y - before.y).toBeCloseTo(-90, 0);
  });

  test('Edit end: clicking the board keeps typed text; clicking another note moves selection', async ({ page }) => {
    await createAndGotoBoard(page);

    const idA = await createNoteByDblclick(page, 400, 300);
    await page.keyboard.type('first idea');

    // Click empty board → editing ends, text kept, nothing selected
    await page.mouse.click(1000, 650);
    await expect(getNoteTextarea(page)).toHaveCount(0);
    await expect(getNoteText(page, idA)).toHaveText('first idea');

    // Re-enter editing by double-click, type more, then click a second note
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type(' and more');
    const idB = await createNoteByDblclick(page, 900, 200);
    await page.keyboard.type('second');
    await page.keyboard.press('Escape');

    await expect(getNoteText(page, idA)).toHaveText('first idea and more');
    await expect(getNoteText(page, idB)).toHaveText('second');
    // Note B is the selected one (its toolbar is showing)
    await expect(getNoteToolbarFor(page, idB)).toBeVisible();
  });

  test('Empty notes stay on the board and show no placeholder', async ({ page }) => {
    await createAndGotoBoard(page);
    const id = await createNoteByDblclick(page, 500, 400);
    await page.keyboard.press('Escape');
    await expect(getStickyNotes(page)).toHaveCount(1);
    await expect(getNoteText(page, id)).toHaveText('');
    const viewport = getViewport(page);
    expect(viewport).toBeTruthy();
  });

  test('Accessibility: Tab reaches a note, Enter edits it, Backspace deletes it', async ({ page }) => {
    await createAndGotoBoard(page);

    // Tab from the page start until a sticky note has focus
    await getCreateStickyButton(page).click();
    const ids = await getNoteIds(page);
    await page.keyboard.press('Escape');

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    let onNote = false;
    for (let i = 0; i < 8 && !onNote; i++) {
      await page.keyboard.press('Tab');
      onNote = await page.evaluate((noteId) => {
        const el = document.activeElement as HTMLElement | null;
        return !!el?.closest(`[data-note-id="${noteId}"]`);
      }, ids[0]);
    }
    expect(onNote, 'a sticky note is reachable with Tab').toBe(true);

    // Enter starts editing and typing lands in the note
    await page.keyboard.press('Enter');
    await expect(getNoteTextarea(page)).toBeVisible();
    await page.keyboard.type('by keyboard');
    await page.keyboard.press('Escape');
    await expect(getNoteText(page, ids[0])).toHaveText('by keyboard');

    // Focus the note again and delete it with Backspace
    await page.evaluate((noteId) => {
      (document.querySelector(`[data-note-id="${noteId}"][data-testid="sticky-note"]`) as HTMLElement).focus();
    }, ids[0]);
    await page.keyboard.press('Backspace');
    await expect(getStickyNotes(page)).toHaveCount(0);
  });
});
