/**
 * Story 2 end-to-end tests: sticky notes in a real browser.
 *
 * The behaviour that needs real layout — text shrinking to fit a full note, and
 * overflowing text fading out where the note runs short of room — can only be
 * checked here, which is why it is not in the jsdom tests. Everything else is
 * also checked here in the round, since the point of the story is doing these
 * things with a mouse on an infinite board.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { RETRO_ITEM, proseOfLength } from '../fixtures/texts';
import {
  deleteButton,
  doubleClickBoard,
  dragByMouse,
  dragNote,
  getBoard,
  getCamera,
  note,
  notes,
  noteText,
  noteToolbar,
  openBoard,
  setCamera,
  stickyInput,
  stickyToolButton,
  swatch
} from './helpers/board';
import {
  STICKY_COLORS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS
} from '../../src/shared/config';

/** The on-screen box of something, failing loudly when it is not drawn. */
async function boxOf(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('the element is not on screen');
  return found;
}

/** A rendered length in CSS pixels, such as the size of a note's text. */
async function pixels(locator: Locator, property: string): Promise<number> {
  const value = await locator.evaluate(
    (element, name) => String(getComputedStyle(element)[name as keyof CSSStyleDeclaration]),
    property
  );
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`${property} is not a length: ${value}`);
  return parsed;
}

/** `#rrggbb` the way the browser reports it, so colours compare fairly. */
function rgb(hex: string): string {
  const digits = hex.replace('#', '');
  const parts = [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16));
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}

/** Stop typing by clicking a part of the board that holds nothing. */
async function clickEmptyBoard(page: Page, x = 140, y = 660): Promise<void> {
  await page.mouse.click(x, y);
}

/** Select a note and start typing where its text ends. */
async function editNote(page: Page, index = 0): Promise<void> {
  await note(page, index).click();
  await page.keyboard.press('Enter');
  await expect(stickyInput(page)).toBeFocused();
}

/** Move the camera so a note sits in the middle of the screen, at a given zoom. */
async function centreOnNote(page: Page, index: number, zoom: number): Promise<void> {
  const all = await getBoard(page);
  const target = all[index];
  if (!target) throw new Error(`there is no note ${index}`);
  await setCamera(page, {
    x: target.x + STICKY_SIZE_WORLD / 2 - 640 / zoom,
    y: target.y + STICKY_SIZE_WORLD / 2 - 400 / zoom,
    zoom
  });
  // The board is drawn a moment after the camera changes, and these tests measure
  // the drawing rather than the camera.
  await expect
    .poll(() => page.locator('[data-vidi6="world"]').evaluate((element) => element.style.transform))
    .toContain(`scale(${zoom})`);
}

/** The character counter of the note being edited, or null when it is hidden. */
async function counterText(page: Page): Promise<string | null> {
  const counter = page.locator('[data-testid="sticky-counter"]');
  if ((await counter.count()) === 0) return null;
  return (await counter.textContent())?.trim() ?? null;
}

test.describe('capturing an idea (sticky.create, sticky.text)', () => {
  test('the story in one go: double-click, write it down, click away, it is on the board', async ({
    page
  }) => {
    await openBoard(page);

    await doubleClickBoard(page, 500, 350);
    await expect(notes(page)).toHaveCount(1);
    await expect(stickyInput(page)).toBeFocused();

    await page.keyboard.type('Ship small, ship often');
    await clickEmptyBoard(page);

    await expect(noteText(page, 0)).toHaveText('Ship small, ship often');
    const stored = await getBoard(page);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ text: 'Ship small, ship often', color: 'yellow' });
  });

  test('TC-35: a double-click makes a note centred on the spot that was clicked', async ({
    page
  }) => {
    await openBoard(page);

    await doubleClickBoard(page, 480, 320);

    const onScreen = await boxOf(note(page, 0));
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(480, 0);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(320, 0);
  });

  test('TC-34: the tool button puts a new note in the middle of what is on screen', async ({
    page
  }) => {
    await openBoard(page);
    // Wander a million units away first: the note must still land in front of you.
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });

    await stickyToolButton(page).click();

    await expect(notes(page)).toHaveCount(1);
    const [stored] = await getBoard(page);
    expect(stored.x).toBeCloseTo(1_000_000 + 640 - STICKY_SIZE_WORLD / 2, 3);
    expect(stored.y).toBeCloseTo(1_000_000 + 400 - STICKY_SIZE_WORLD / 2, 3);
    const onScreen = await boxOf(note(page, 0));
    expect(onScreen.x + onScreen.width / 2).toBeCloseTo(640, 0);
    expect(onScreen.y + onScreen.height / 2).toBeCloseTo(400, 0);
  });

  test('TC-36: a double-click on a note edits it instead of making another one', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('one note');
    await clickEmptyBoard(page);
    expect(await getBoard(page)).toHaveLength(1);

    await note(page, 0).dblclick();

    await expect(notes(page)).toHaveCount(1);
    await expect(stickyInput(page)).toHaveValue('one note');
    await expect(stickyInput(page)).toBeFocused();
    // The caret is at the end, ready to carry on writing.
    const caret = await stickyInput(page).evaluate((element) => {
      const area = element as HTMLTextAreaElement;
      return { start: area.selectionStart, end: area.selectionEnd };
    });
    expect(caret).toEqual({ start: 'one note'.length, end: 'one note'.length });
  });

  test('TC-36: notes made one after another keep their own text', async ({ page }) => {
    await openBoard(page);

    await doubleClickBoard(page, 420, 300);
    await page.keyboard.type('first');
    await clickEmptyBoard(page, 140, 700);
    await doubleClickBoard(page, 860, 480);
    await page.keyboard.type('second');
    await clickEmptyBoard(page, 140, 700);

    await expect(noteText(page, 0)).toHaveText('first');
    await expect(noteText(page, 1)).toHaveText('second');
    // The new note did not take anything off the old one.
    expect((await getBoard(page)).map((item) => item.text)).toEqual(['first', 'second']);
  });

  test('TC-16: a paste longer than the limit keeps exactly 1,000 characters', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);

    // insertText arrives as one input event, exactly as a paste does.
    await page.keyboard.insertText(`${proseOfLength(STICKY_TEXT_MAX_CHARS)}overflow`);

    const [stored] = await getBoard(page);
    expect(stored.text).toBe(proseOfLength(STICKY_TEXT_MAX_CHARS));
    expect(await counterText(page)).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    // Nothing more can be typed into a full note.
    await page.keyboard.type('no');
    expect((await getBoard(page))[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  test('the counter appears only near the limit, where the user needs it', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    const boundary = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;

    await page.keyboard.type('a short idea');
    expect(await counterText(page)).toBeNull();

    // Fill the note up to one character before the counter appears, then one more.
    const typed = 'a short idea'.length;
    await page.keyboard.insertText(proseOfLength(boundary - typed - 1));
    expect(await counterText(page)).toBeNull();

    await page.keyboard.type('x');
    expect(await counterText(page)).toBe(`${boundary}/${STICKY_TEXT_MAX_CHARS}`);
  });

  test('TC-31: an input method commits once, without leaving fragments behind', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('ship ');

    // Chromium cannot drive a real keyboard layout, so the composition events are
    // dispatched in the page exactly as an input method sends them.
    await stickyInput(page).evaluate((element) => {
      const area = element as HTMLTextAreaElement;
      const compose = (type: string, data: string) =>
        area.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
      const typed = () =>
        area.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText' })
        );
      compose('compositionstart', 'k');
      area.value = 'ship kaeru';
      typed();
      area.value = 'ship かえる';
      compose('compositionupdate', 'かえる');
      typed();
      compose('compositionend', 'かえる');
      typed();
    });

    await expect.poll(() => getBoard(page)).toEqual([
      expect.objectContaining({ text: 'ship かえる' })
    ]);
  });
});

test.describe('rearranging notes (sticky.move)', () => {
  test('TC-20: at 100% the note follows the pointer exactly', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('move me');
    await clickEmptyBoard(page);
    const before = await getBoard(page);
    const onScreenBefore = await boxOf(note(page, 0));

    await dragNote(page, 0, 150, 90);

    const after = await getBoard(page);
    expect(after[0].x).toBeCloseTo(before[0].x + 150, 1);
    expect(after[0].y).toBeCloseTo(before[0].y + 90, 1);
    const onScreenAfter = await boxOf(note(page, 0));
    expect(onScreenAfter.x).toBeCloseTo(onScreenBefore.x + 150, 0);
    expect(onScreenAfter.y).toBeCloseTo(onScreenBefore.y + 90, 0);
    // A dragged note stays selected, ready for the next move or a colour.
    await expect(note(page, 0)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-21: at 50% the same drag moves the note twice as far in world units', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await clickEmptyBoard(page);
    await centreOnNote(page, 0, 0.5);
    const before = await getBoard(page);

    await dragNote(page, 0, 150, 0);

    const after = await getBoard(page);
    expect(after[0].x).toBeCloseTo(before[0].x + 300, 1);
    expect(after[0].y).toBeCloseTo(before[0].y, 1);
  });

  test('TC-23: dragging a note never pans the board', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await clickEmptyBoard(page);
    const cameraBefore = await getCamera(page);
    const before = await getBoard(page);

    await dragNote(page, 0, -180, -120);

    // Panning is for the empty board only: the camera did not move an inch.
    expect(await getCamera(page)).toEqual(cameraBefore);
    // And the note really did move, rather than the board having shifted under it.
    const after = await getBoard(page);
    expect(after[0].x).toBeCloseTo(before[0].x - 180, 1);
  });

  test('TC-25: a note dragged onto another ends up in front of it', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 460, 360);
    await page.keyboard.type('under');
    await clickEmptyBoard(page, 140, 680);
    await doubleClickBoard(page, 760, 360);
    await page.keyboard.type('over');
    await clickEmptyBoard(page, 140, 680);
    expect((await getBoard(page)).map((item) => item.text)).toEqual(['under', 'over']);

    // Drop the first note squarely on top of the second.
    await dragNote(page, 0, 300, 0);

    const order = await getBoard(page);
    expect(order.map((item) => item.text)).toEqual(['over', 'under']);
    expect(order[1].z).toBeGreaterThan(order[0].z);
  });

  test('a note keeps its place on the board while the board is panned and zoomed', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('stays put');
    await clickEmptyBoard(page);
    const before = await getBoard(page);

    // A drag of empty board pans it; the note is left where it belongs.
    await dragByMouse(page, { x: 150, y: 620 }, { x: 370, y: 530 });
    await page.mouse.move(900, 700);
    await page.mouse.wheel(0, -400);

    const after = await getBoard(page);
    expect(after[0].x).toBeCloseTo(before[0].x, 6);
    expect(after[0].y).toBeCloseTo(before[0].y, 6);
    await expect(noteText(page, 0)).toHaveText('stays put');
  });
});

test.describe('recolouring, deleting and editing (sticky.recolour, sticky.delete)', () => {
  test('TC-27: a colour from the toolbar recolours the note and changes nothing else', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('decision needed');
    await clickEmptyBoard(page);

    await note(page, 0).click();
    await swatch(page, 'orange').click();

    await expect(note(page, 0)).toHaveAttribute('data-color', 'orange');
    await expect(note(page, 0)).toHaveCSS('background-color', rgb(STICKY_COLORS.orange));
    const [stored] = await getBoard(page);
    expect(stored).toMatchObject({ text: 'decision needed', color: 'orange' });
    // Still selected, so the user can keep working on it.
    await expect(note(page, 0)).toHaveAttribute('data-selected', 'true');
  });

  test('TC-28: the bin button deletes the note along with its text', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('in the bin');
    await clickEmptyBoard(page);

    await note(page, 0).click();
    await deleteButton(page, 0).click();

    await expect(notes(page)).toHaveCount(0);
    expect(await getBoard(page)).toHaveLength(0);
  });

  test('TC-29: Delete removes the selected note; with nothing selected it does nothing', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('temporary');
    await clickEmptyBoard(page);

    await note(page, 0).click();
    await page.keyboard.press('Delete');

    await expect(notes(page)).toHaveCount(0);
    expect(await getBoard(page)).toHaveLength(0);

    // The keys have nothing to bite on now, and must not disturb the board.
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    expect(await getBoard(page)).toHaveLength(0);
  });

  test('keys typed into a note never delete it', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('text with spaces');

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');

    expect((await getBoard(page))[0].text).toBe('text with space');
    await expect(notes(page)).toHaveCount(1);
  });

  test('TC-32: Enter edits the selected note and Escape keeps what was typed', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await page.keyboard.type('press enter');
    await clickEmptyBoard(page);

    await editNote(page);
    await page.keyboard.type(' and carry on');
    await page.keyboard.press('Escape');

    await expect(noteText(page, 0)).toHaveText('press enter and carry on');
    await expect(note(page, 0)).toHaveAttribute('data-selected', 'true');
  });

  test('clicking the board clears the selection and hides the note toolbar', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 500, 350);
    await clickEmptyBoard(page);
    await note(page, 0).click();
    await expect(noteToolbar(page, 0)).toBeVisible();

    await clickEmptyBoard(page, 140, 700);

    await expect(note(page, 0)).toHaveAttribute('data-selected', 'false');
    await expect(noteToolbar(page, 0)).toHaveCount(0);
  });
});

test.describe('notes on an infinite canvas (AC-16, AC-17, AC-18)', () => {
  test('TC-37: a note scales with the board while its toolbar stays the same size', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.type('scales with the board');
    await clickEmptyBoard(page);
    await note(page, 0).click();

    const sizes = [];
    for (const zoom of [1, 0.5, 2]) {
      await centreOnNote(page, 0, zoom);
      sizes.push({
        note: (await boxOf(note(page, 0))).width,
        toolbar: (await boxOf(noteToolbar(page, 0))).height
      });
    }

    expect(sizes[0].note).toBeCloseTo(STICKY_SIZE_WORLD, 0);
    expect(sizes[1].note).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);
    expect(sizes[2].note).toBeCloseTo(STICKY_SIZE_WORLD * 2, 0);
    // A control is a control: it does not grow with the board.
    expect(sizes[1].toolbar).toBeCloseTo(sizes[0].toolbar, 0);
    expect(sizes[2].toolbar).toBeCloseTo(sizes[0].toolbar, 0);
  });

  test('TC-33: text shrinks to fit a full note, down to the smallest size', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.type('Ship often');
    await page.keyboard.press('Escape');

    // Short text uses the largest size in the range.
    await expect(noteText(page, 0)).toHaveCSS('font-size', `${STICKY_FONT_MAX_PX}px`);

    // A three-line retrospective item no longer fits at that size.
    await editNote(page);
    await page.keyboard.type(RETRO_ITEM);
    await page.keyboard.press('Escape');
    const shrunk = await pixels(noteText(page, 0), 'font-size');
    expect(shrunk).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(shrunk).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);

    // A note at the limit sits at the smallest size and fades its text away.
    await editNote(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(proseOfLength(STICKY_TEXT_MAX_CHARS));
    await page.keyboard.press('Escape');

    await expect(noteText(page, 0)).toHaveCSS('font-size', `${STICKY_FONT_MIN_PX}px`);
    await expect(note(page, 0)).toHaveAttribute('data-overflow', 'true');
    // The text really is longer than the room the note gives it...
    const clipped = await noteText(page, 0).evaluate((element) => ({
      content: element.scrollHeight,
      room: element.clientHeight
    }));
    expect(clipped.content).toBeGreaterThan(clipped.room);
    // ...and it is the note that hides the rest, not the page.
    await expect(note(page, 0)).toHaveCSS('overflow', 'visible');
    await expect(noteText(page, 0)).toHaveCSS('overflow', 'hidden');
  });

  test('TC-34: an overfull note fades its text at the bottom edge; others do not', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.insertText(proseOfLength(STICKY_TEXT_MAX_CHARS));
    await page.keyboard.press('Escape');

    const fade = note(page, 0).locator('[data-testid="sticky-fade"]');
    await expect(fade).toHaveCount(1);
    const noteBox = await boxOf(note(page, 0));
    const fadeBox = await boxOf(fade);
    expect(fadeBox.x).toBeCloseTo(noteBox.x, 0);
    expect(fadeBox.width).toBeCloseTo(noteBox.width, 0);
    expect(fadeBox.y + fadeBox.height).toBeCloseTo(noteBox.y + noteBox.height, 0);

    // A note with room to spare shows all of its text and no fade.
    await doubleClickBoard(page, 300, 640);
    await page.keyboard.type('short note');
    await clickEmptyBoard(page, 140, 200);
    await expect(note(page, 1).locator('[data-testid="sticky-fade"]')).toHaveCount(0);
    await expect(noteText(page, 1)).toHaveText('short note');
  });

  test('TC-38: a small note far out is still a note — select it, colour it, read it', async ({
    page
  }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.type('idea one');
    await clickEmptyBoard(page);

    await centreOnNote(page, 0, 0.5);
    expect((await boxOf(note(page, 0))).width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 0);

    await note(page, 0).click();
    await expect(note(page, 0)).toHaveAttribute('data-selected', 'true');
    await swatch(page, 'green').click();
    await expect(note(page, 0)).toHaveAttribute('data-color', 'green');
    await expect(noteText(page, 0)).toHaveText('idea one');

    // And it is still in the same place on the board as when it was written.
    const stored = await getBoard(page);
    expect(stored[0].x).toBeCloseTo(-100, 6);
    expect(stored[0].y).toBeCloseTo(-100, 6);
  });

  test('a note is still there after the board wanders off and back', async ({ page }) => {
    await openBoard(page);
    await doubleClickBoard(page, 640, 400);
    await page.keyboard.type('found me');
    await clickEmptyBoard(page);
    const [before] = await getBoard(page);

    await setCamera(page, { x: 500_000, y: -500_000, zoom: 3 });
    // Out of sight, but still on the board.
    expect((await getBoard(page))[0].text).toBe('found me');

    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await expect(noteText(page, 0)).toHaveText('found me');
    const [after] = await getBoard(page);
    expect(after).toMatchObject({ x: before.x, y: before.y, color: before.color });
  });
});
