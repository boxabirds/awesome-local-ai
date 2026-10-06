/**
 * Story 9, end to end: free text on the board, with real fonts and the real room server.
 *
 * TC-26 a long annotation stops at the comfortable line length and the height follows the words
 * TC-27 a side handle sets a fixed width: the words rewrap, the height grows, no top or bottom handle
 * TC-28 title a retro section: place it, type it, size it up, move it, delete it, undo it
 * TC-29 two people typing into the same text keep every character, on both screens
 * TC-30 every person on a full board places a heading, and everybody sees all of them
 * TC-31 text abandoned without a single character leaves nothing behind
 *
 * Two points of view run through the file. The *stored* box (world units, what travels to everybody)
 * and the *drawn* one (this browser, this font). Wrapping is the part of the story that depends on a
 * real font, so it is asserted here rather than in jsdom: the height the board stores has to be the
 * height the words actually take, or somebody's annotation is cut off.
 */
import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_BOX_PADDING_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { navigateToNewBoard } from './helpers/navigate';
import { dragToPoint, noteCentre, noteCount } from './helpers/notes';
import { closeParticipants, openParticipants } from './helpers/participants';
import { proseOfLength } from '../fixtures/texts';
import * as text from './helpers/texts';

test.use({ actionTimeout: 10_000 });

/** The laptop viewport of the suite; its centre is where the world origin is put. */
const CENTRE = { x: 640, y: 400 };

/** Puts the world origin at the middle of the screen, at 1:1, so screen and world differ by a constant. */
async function originCamera(page: Page): Promise<void> {
  await setCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
}

/** A heading a person would actually type, named after who typed it. */
const heading = (index: number): string => `Heading ${index + 1}`;

test.describe('a long annotation (TC-26)', () => {
  test('a 300 character sentence stops at the maximum width and its height follows the wrapped lines', async ({
    browser,
  }) => {
    const participants = await openParticipants(browser, newBoardId(), 2);
    const [author, watcher] = participants;
    try {
      await originCamera(author.page);
      await originCamera(watcher.page);

      const sentence = proseOfLength(300);
      const id = await text.addText(author.page, { x: 220, y: 200 }, sentence);

      // the box widens to the comfortable line length and no further
      const box = await text.storedTextBox(author.page, id);
      expect(Math.abs(box.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);

      // the height is what the wrapped words need, and nothing is cut off
      const lines = await text.renderedLineCount(author.page, id);
      expect(lines).toBeGreaterThanOrEqual(3);
      expect(box.height).toBeGreaterThanOrEqual(lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT - 1);
      expect(await text.textIsWhole(author.page, id)).toBe(true);
      expect((await text.textInDoc(author.page, id))?.text).toBe(sentence);

      // the other screen is told the box, and its own drawing of the same words fits inside it
      await expect
        .poll(() => text.storedTextBox(watcher.page, id), {
          message: 'the second screen never got the box',
          timeout: 10_000,
        })
        .toEqual(box);
      expect(await text.textIsWhole(watcher.page, id)).toBe(true);

      // a reload shows exactly what was stored
      await watcher.page.reload();
      await expect(watcher.page.getByTestId('board-viewport')).toBeVisible();
      await expect.poll(() => text.storedTextBox(watcher.page, id)).toEqual(box);
      await text.expectTextContent(watcher.page, id, sentence.slice(0, 40));
      expect(await text.textIsWhole(watcher.page, id)).toBe(true);
    } finally {
      await closeParticipants(participants);
    }
  });

  test('a short line makes a box only just wider than the words it holds', async ({ page }) => {
    await navigateToNewBoard(page);
    await originCamera(page);

    const id = await text.addText(page, { x: 300, y: 200 }, 'Went well');

    const box = await text.storedTextBox(page, id);
    const words = await text.measureInPage(page, 'Went well', TEXT_SIZES.M);
    expect(box.width).toBeGreaterThan(words);
    expect(box.width).toBeLessThanOrEqual(words + 2 * TEXT_BOX_PADDING_WORLD + 1);
    expect(box.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);
    expect(await text.textIsWhole(page, id)).toBe(true);
  });
});

test.describe('a fixed width (TC-27)', () => {
  test('dragging the right handle rewraps the words, grows the height, and offers no corner handles', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await originCamera(page);

    const sentence = 'Documentation should live next to the code it describes';
    const id = await text.addText(page, { x: 260, y: 220 }, sentence);
    const auto = await text.storedTextBox(page, id);
    expect((await text.textInDoc(page, id))?.widthMode).toBe('auto');
    expect(auto.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    expect(auto.height).toBeCloseTo(TEXT_SIZES.M * TEXT_LINE_HEIGHT, 1);

    await text.selectText(page, id);
    // a text on its own is widened and narrowed, never stretched: the height belongs to the words
    expect(await text.handleNames(page)).toEqual(['e', 'w']);

    await text.dragHandleBy(page, 'e', -140, 0);

    const fixed = await text.storedTextBox(page, id);
    expect((await text.textInDoc(page, id))?.widthMode).toBe('fixed');
    expect(Math.abs(fixed.width - (auto.width - 140))).toBeLessThanOrEqual(2);
    expect(fixed.height).toBeGreaterThan(auto.height);
    expect(await text.textIsWhole(page, id)).toBe(true);
    await expect(text.textN(page, id)).toHaveAttribute('data-width-mode', 'fixed');
    await text.expectTextContent(page, id, sentence);

    // the narrower width and the taller box are what anybody else gets, reload included
    await page.reload();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await expect.poll(() => text.storedTextBox(page, id)).toEqual(fixed);
    await expect(text.textN(page, id)).toHaveAttribute('data-width-mode', 'fixed');
  });

  test('dragging a side handle narrower than the minimum stops at the minimum', async ({ page }) => {
    await navigateToNewBoard(page);
    await originCamera(page);
    const id = await text.addText(page, { x: 300, y: 240 }, 'A short label');

    await text.selectText(page, id);
    const before = await text.storedTextBox(page, id);
    // dragged far past the end of the box: the width stops at the minimum instead of turning inside out
    await text.dragHandleBy(page, 'e', -900, 0);

    const after = await text.storedTextBox(page, id);
    expect(after.width).toBe(TEXT_MIN_WIDTH_WORLD);
    expect(after.width).toBeLessThan(before.width);
    expect((await text.textInDoc(page, id))?.widthMode).toBe('fixed');
    expect(await text.textIsWhole(page, id)).toBe(true);
  });
});

test.describe('titling a section (TC-28)', () => {
  test('a heading is typed, sized up, moved over the cluster, deleted and undone', async ({ page }) => {
    await navigateToNewBoard(page);
    await originCamera(page);

    // the cluster the heading belongs to, near the middle of the screen
    const note = await page.evaluate(() => window.__vidi6!.createNote(60, 60));
    const id = await text.addText(page, { x: 200, y: 140 }, 'Went well');
    const typed = await text.textBoxOnScreen(page, id);
    expect(typed.x).toBeLessThan(300);

    // bigger, and still standing on the same corner
    await text.selectText(page, id);
    await text.setTextSize(page, id, 'Extra large');
    const grown = await text.textBoxOnScreen(page, id);
    expect(grown.x).toBeCloseTo(typed.x, 1);
    expect(grown.y).toBeCloseTo(typed.y, 1);
    expect(grown.height).toBeGreaterThan(typed.height);
    expect(await text.textFont(page, id)).toEqual({
      fontSize: TEXT_SIZES.XL,
      lineHeight: TEXT_SIZES.XL * TEXT_LINE_HEIGHT,
    });

    // dragged over the cluster it belongs to
    const cluster = await noteCentre(page, 0);
    const centreOf = { x: grown.x + grown.width / 2, y: grown.y + grown.height / 2 };
    await dragToPoint(page, centreOf, cluster);
    const moved = await text.textInDoc(page, id);
    const box = await text.storedTextBox(page, id);
    const drawn = await text.textBoxOnScreen(page, id);
    const centre = { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 };
    const noteBox = await page.locator(`[data-note-id="${note}"]`).boundingBox();
    expect(noteBox).not.toBeNull();
    expect(centre.x).toBeGreaterThan(noteBox!.x);
    expect(centre.x).toBeLessThan(noteBox!.x + noteBox!.width);
    expect(centre.y).toBeGreaterThan(noteBox!.y);
    expect(centre.y).toBeLessThan(noteBox!.y + noteBox!.height);

    // deleted, and the cluster stays
    await page.keyboard.press('Delete');
    await expect(text.textN(page, id)).toHaveCount(0);
    expect(await text.textCount(page)).toBe(0);
    expect(await noteCount(page)).toBe(1);

    // one undo brings back the heading as it was: XL, the words, the place it was dragged to
    await page.keyboard.press('Control+z');
    await expect(text.textN(page, id)).toHaveCount(1);
    const restored = await text.textInDoc(page, id);
    expect(restored?.text).toBe('Went well');
    expect(restored?.size).toBe('XL');
    expect(await text.storedTextBox(page, id)).toEqual(box);
    expect(restored?.x).toBe(moved?.x);
    expect(restored?.y).toBe(moved?.y);
    expect(await text.textFont(page, id)).toEqual({
      fontSize: TEXT_SIZES.XL,
      lineHeight: TEXT_SIZES.XL * TEXT_LINE_HEIGHT,
    });
  });

  test('the four sizes are the four presets of the design, and the zoom scales them with the board', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await originCamera(page);

    const presets = [
      { preset: 'Small' as const, size: 'S' as const },
      { preset: 'Large' as const, size: 'L' as const },
      { preset: 'Extra large' as const, size: 'XL' as const },
    ];
    const ids: string[] = [];
    for (const [index, entry] of presets.entries()) {
      const id = await text.addText(page, { x: 160, y: 140 + index * 120 }, `Size ${entry.size}`);
      await text.selectText(page, id);
      await text.setTextSize(page, id, entry.preset);
      ids.push(id);
      const font = await text.textFont(page, id);
      expect(font.fontSize).toBe(TEXT_SIZES[entry.size]);
      expect(font.lineHeight).toBeCloseTo(TEXT_SIZES[entry.size] * TEXT_LINE_HEIGHT, 1);
      // one line of this size is the height of the box
      expect((await text.storedTextBox(page, id)).height).toBeCloseTo(
        TEXT_SIZES[entry.size] * TEXT_LINE_HEIGHT,
        1,
      );
    }
    // the text nobody sized is the default
    const plain = await text.addText(page, { x: 160, y: 520 }, 'Size M');
    expect((await text.textInDoc(page, plain))?.size).toBe('M');

    // zooming scales the drawn text with everything else; the preset itself does not change
    const before = await text.textBoxOnScreen(page, plain);
    await setCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 2 });
    const after = await text.textBoxOnScreen(page, plain);
    expect(after.width / before.width).toBeCloseTo(2, 1);
    expect(after.height / before.height).toBeCloseTo(2, 1);
    expect(await text.textFont(page, plain)).toEqual({
      fontSize: TEXT_SIZES.M,
      lineHeight: TEXT_SIZES.M * TEXT_LINE_HEIGHT,
    });
  });
});

test.describe('two people, one text (TC-29)', () => {
  test('typing into the same text at the same time keeps every character on both screens', async ({
    browser,
  }) => {
    const participants = await openParticipants(browser, newBoardId(), 2);
    const [alex, sam] = participants;
    try {
      await originCamera(alex.page);
      await originCamera(sam.page);

      const id = await text.addText(alex.page, { x: 460, y: 360 }, 'start:');
      await expect
        .poll(() => text.textInDoc(sam.page, id).then((object) => object?.text), {
          message: 'the second screen never saw the text',
          timeout: 10_000,
        })
        .toBe('start:');

      // both get into the same text, then both type, without waiting for the other
      await text.editText(alex.page, id);
      await text.editText(sam.page, id);
      await Promise.all([
        alex.page.keyboard.type('AAAA', { delay: 25 }),
        sam.page.keyboard.type('BBBB', { delay: 25 }),
      ]);
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');

      const count = (value: string, character: string): number =>
        [...value].filter((seen) => seen === character).length;
      await expect
        .poll(
          async () => {
            const [here, there] = await Promise.all([
              text.textInDoc(alex.page, id),
              text.textInDoc(sam.page, id),
            ]);
            return (
              here !== undefined &&
              there !== undefined &&
              here.text === there.text &&
              here.text.startsWith('start:') &&
              count(here.text, 'A') >= 4 &&
              count(here.text, 'B') >= 4
            );
          },
          { message: 'the shared text never converged', timeout: 10_000 },
        )
        .toBe(true);

      // both screens draw the same words in the same box, and neither box is too short
      const [here, there] = await Promise.all([
        text.storedTextBox(alex.page, id),
        text.storedTextBox(sam.page, id),
      ]);
      expect(there).toEqual(here);
      for (const participant of participants) {
        expect(await text.textIsWhole(participant.page, id)).toBe(true);
        const rendered = await text
          .textN(participant.page, id)
          .locator('.board-text__content')
          .textContent();
        expect(rendered).toBe((await text.textInDoc(participant.page, id))?.text);
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('a full board of headings (TC-30)', () => {
  test(`every one of ${MAX_CONCURRENT_EDITORS} people places a heading and everybody sees them all`, async ({
    browser,
  }) => {
    const participants = await openParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS);
    try {
      // everybody looks at the board from the same point, so a screen point is the same world point
      for (const participant of participants) await originCamera(participant.page);

      // one spot each, clear of the others, so nobody clicks on somebody else's heading
      const spots = participants.map((participant, index) => ({
        page: participant.page,
        at: { x: 140 + index * 150, y: 120 + index * 110 },
        title: heading(index),
      }));

      // all at the same time: T, click, type, Escape
      const ids = await Promise.all(
        spots.map((spot) => text.addText(spot.page, spot.at, spot.title)),
      );

      // every screen ends up with every heading, in its own document and on the screen. The count
      // alone is not the end of it: a heading that has appeared is not necessarily finished being
      // typed, and this is a test that everybody has all of it.
      const titlesOn = (page: Page) =>
        text.getTexts(page).then((objects) => objects.map((object) => object.text).sort());
      const expected = spots.map((spot) => spot.title).sort();
      for (const participant of participants) {
        await expect
          .poll(() => titlesOn(participant.page), {
            message: `${participant.name} never holds all ${MAX_CONCURRENT_EDITORS} headings`,
            timeout: 20_000,
          })
          .toEqual(expected);
        expect(await text.textCount(participant.page)).toBe(MAX_CONCURRENT_EDITORS);
        for (const [index, id] of ids.entries()) {
          await text.expectTextContent(participant.page, id, heading(index));
        }
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('abandoned text (TC-31)', () => {
  test('a text left without a character is gone, and the spot holds nothing to select', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await originCamera(page);
    const spot = { x: 520, y: 300 };

    await text.pickTextTool(page);
    await page.mouse.click(spot.x, spot.y);
    await expect(text.editorOf(page)).toBeVisible();
    expect(await text.textCount(page)).toBe(1); // it is there while she is writing it

    await page.keyboard.press('Escape');
    await expect(text.editorOf(page)).toHaveCount(0);
    expect(await text.textCount(page)).toBe(0);
    expect(await page.locator('[data-text-id]').count()).toBe(0);

    // the spot is empty: a marquee dragged over it selects nothing
    await text.pickSelectTool(page);
    await page.keyboard.down('Shift');
    await page.mouse.move(spot.x - 80, spot.y - 60);
    await page.mouse.down();
    await page.mouse.move(spot.x + 240, spot.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await page.locator('.selection-handle').count()).toBe(0);
    expect(await page.locator('.selection-bbox').count()).toBe(0);

    // and it stays empty when the pointer leaves: no invisible text is left to tidy up later
    expect(await text.textCount(page)).toBe(0);
    expect(await noteCount(page)).toBe(0);
  });

  test('a text typed and then clicked away is kept, and the click does not select the board away', async ({
    page,
  }) => {
    await navigateToNewBoard(page);
    await originCamera(page);

    const id = await text.addText(page, { x: 300, y: 260 }, 'To improve');
    await text.editText(page, id);
    await page.keyboard.type(' later');
    await expect(text.editorOf(page)).toHaveValue('To improve later');

    // a click on empty board space ends the edit; the words stay, on the screen and in the document
    await page.mouse.click(900, 700);
    await expect(text.editorOf(page)).toHaveCount(0);
    expect((await text.textInDoc(page, id))?.text).toBe('To improve later');
    await text.expectTextContent(page, id, 'To improve later');
  });
});
