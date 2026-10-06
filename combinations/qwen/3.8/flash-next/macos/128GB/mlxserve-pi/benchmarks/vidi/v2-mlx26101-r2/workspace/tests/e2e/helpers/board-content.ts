/**
 * A board with real content on it, made the way a person makes it.
 *
 * Two of this story's e2e tests need a board that is worth coming back to - TC-19, to
 * find again after the server is killed, and TC-24, to fail to load and then reappear -
 * and both have to be able to say *what* was there, so that "everything came back" is a
 * comparison and not a count. A board of 25 notes that all say the same thing, in the
 * same colour, in a line, in the order they were made, would round-trip a good deal
 * less than the board this makes.
 *
 * What goes into it, and why:
 *
 * - text of different lengths, some over two lines, from the vocabulary the fixtures
 *   use elsewhere - so a note that came back as a different note is visible;
 * - every colour in the palette, on at least a few notes each;
 * - places on a grid tight enough that notes overlap, with three of them moved by real
 *   drags afterwards, which takes them off the grid and puts the stacking order in an
 *   order nothing else would produce;
 * - and the ids, which the tests compare too: the same board, not a board that looks
 *   like it.
 */

import { expect, type Page } from '@playwright/test';

import type { StickySnapshot } from '../../../src/shared/board-model.js';
import { STICKY_COLOR_NAMES } from '../../../src/shared/config.js';
import type { Point } from '../../../src/client/canvas/camera.js';
import { phrase } from '../../fixtures/boards.js';
import {
  colorSwatch,
  docNotes,
  doubleClickBoard,
  dragNote,
  escapeEditing,
  noteCentre,
  notes,
  waitForNoteCount,
} from './sticky.js';

/** Where the notes are made: a 5 x 5 field, spaced less than a note's width so they overlap. */
const FIELD: Point[] = [];
for (let row = 0; row < 5; row += 1) {
  for (let column = 0; column < 5; column += 1) {
    FIELD.push({ x: 260 + column * 190, y: 170 + row * 130 });
  }
}

/** The board a test left behind, in the order it was left in. */
export type Left = StickySnapshot[];

/** The board as the page's own document has it, in drawing order. */
export const drawnNotes = (page: Page): Promise<Left> => docNotes(page);

/** Note ids in drawing order: notes that came back permuted differ here. */
export const noteIds = async (page: Page): Promise<string[]> =>
  (await drawnNotes(page)).map((note) => note.id);

/** Every note's box on screen, in drawing order: the pixels the board is drawn with. */
export async function noteBoxes(page: Page): Promise<string[]> {
  const boxes: string[] = [];
  const count = await notes(page).count();
  for (let index = 0; index < count; index += 1) {
    const box = await notes(page).nth(index).boundingBox();
    if (box === null) throw new Error(`note ${index} is in the document but not drawn`);
    const { x, y, width, height } = box;
    boxes.push(`${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`);
  }
  return boxes;
}

/**
 * Create `count` notes through the UI - double-click, type, colour, drag - and hand back
 * what the board looks like when that is done. That is the board the test claims came
 * back, so it is read out of the page rather than remembered from the input.
 */
export async function fillBoard(page: Page, count: number): Promise<Left> {
  for (let index = 0; index < count; index += 1) {
    const point = FIELD[index % FIELD.length]!;
    await doubleClickBoard(page, point);
    // Text of different lengths, and a few notes with a line break in them.
    const text = index % 7 === 3 ? `${phrase(index)}\n${phrase(index + 100)}` : phrase(index);
    await page.keyboard.type(text);
    await escapeEditing(page);
    // A third of the notes get a colour of their own, cycling through the palette, so
    // the board left behind has every colour in it; the rest keep the default.
    if (index % 3 === 1) {
      const color = STICKY_COLOR_NAMES[Math.floor(index / 3) % STICKY_COLOR_NAMES.length]!;
      await colorSwatch(page, color).click();
    }
  }
  await waitForNoteCount(page, count);

  // Move three notes with real drags: their positions leave the grid they were made on,
  // and a drag raises a note, so the stacking order is not simply the creation order.
  const moved = await drawnNotes(page);
  for (const index of [2, 11, 23].filter((i) => i < count)) {
    const note = moved[index];
    if (note === undefined) continue;
    const position = await drawnNotes(page);
    const drawIndex = position.findIndex((candidate) => candidate.id === note.id);
    const from = await noteCentre(page, drawIndex);
    await dragNote(page, from, { x: 120 + index * 30, y: 700 - index * 20 });
  }
  await waitForNoteCount(page, count);
  return await drawnNotes(page);
}

/**
 * The checks that this board is varied enough to be worth testing with: a board that is
 * one colour, or all one text, or stacked in creation order, passes a comparison that
 * would not notice a board coming back wrong.
 */
export async function expectVariedBoard(page: Page, count: number): Promise<Left> {
  const left = await drawnNotes(page);
  expect(left).toHaveLength(count);
  expect(
    new Set(left.map((note) => note.color)).size,
    'this board is one colour, so a board that came back in the wrong colours would pass',
  ).toBeGreaterThanOrEqual(4);
  expect(new Set(left.map((note) => note.text)).size).toBe(count);
  expect(new Set(left.map((note) => note.z)).size).toBe(count);
  return left;
}
