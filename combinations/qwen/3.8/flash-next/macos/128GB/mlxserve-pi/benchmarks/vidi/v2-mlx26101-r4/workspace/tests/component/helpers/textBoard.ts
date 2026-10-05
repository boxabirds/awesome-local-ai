/**
 * Helpers for the story 9 component tests: placing, typing into, sizing and dragging a piece of text.
 *
 * Three rules run through this file.
 *
 * **The board is driven the way a person drives it.** A piece of text is created by pressing `T` and clicking
 * the board, not by calling `createText` — with one exception, {@link addText}, which exists for tests about
 * the *model* of a text object rather than about the tool that makes one. Everything else in here is a
 * keystroke or a pointer event.
 *
 * **Measurements are the test's, not the machine's.** A box is a number that comes out of a font, and no
 * assertion about a number that comes out of a font belongs in a component test on an unknown laptop. So
 * {@link measureWithFakeFont} swaps in the layout tests' measurer, which counts half a font size per
 * character, and every expected box in these files is arithmetic a reader can check by eye. The real font is
 * what the end-to-end tests measure with.
 *
 * **The document is the witness.** Every assertion is about what the document holds, read through
 * `window.__vidi6`, or about what the components publish in the DOM. jsdom performs no layout, so nothing in
 * here claims anything about where a pixel landed.
 */
import { afterEach, expect } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
// A value import, not a type import: these helpers reach for `Y.Text` and `Y.Map` at run time, to tell one
// from a plain value while reading a document back.
import * as Y from 'yjs';

import { createText } from '../../../src/shared/objects/text';
import type { TextSnapshot } from '../../../src/shared/objects/text';
import { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
import { TEXT_ESTIMATED_GLYPH_RATIO, TEXT_LINE_HEIGHT, TEXT_PADDING_WORLD, TEXT_SIZES } from '../../../src/shared/config';
import {
  getMeasurer,
  setMeasurer,
} from '../../../src/client/objects/textLayout';
import type { TextMeasurer } from '../../../src/client/objects/textLayout';
import { fakeMeasurer } from '../../fixtures/texts';
import {
  camera,
  doc,
  pointerDown,
  somebodyElse,
  surface,
} from './stickyBoard';
import { upWindow } from './selection';
import type { Point } from '../../../src/shared/geometry';

// Re-exported so a story 9 test imports the whole vocabulary of a piece of text from one file.
export {
  BOARD_ID,
  boardExists,
  camera,
  doc,
  hasTextarea,
  noConnection,
  noteId,
  pointerDown,
  renderBoard,
  somebodyElse,
  stickies,
  surface,
  textarea,
  typeText,
} from './stickyBoard';
export { screenToWorld, worldToScreen } from '../../../src/client/canvas/camera';
export { upWindow, moveWindow, pressOn, drag, dragHandle, objectById, objects, outlinedIds } from './selection';
export type { TextSnapshot };

/** The id a piece of text carries in the DOM, which is how a test names one. */
const TEXT_SELECTOR = '[data-text-id]';

/** Every piece of text on the board, in stacking order, read from the document. */
export function texts(): readonly TextSnapshot[] {
  return window.__vidi6?.getTexts() ?? [];
}

/** One piece of text by id; throws when it is gone, which is what a test asserting its survival wants. */
export function textById(id: string): TextSnapshot {
  const found = texts().find((text) => text.id === id);
  if (!found) throw new Error(`no text with id ${id} on the board: ${JSON.stringify(texts().map((t) => t.id))}`);
  return found;
}

/** The text elements, in the order the board stacks them. */
export function textElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TEXT_SELECTOR));
}

/** The id of the nth piece of text on the board. */
export function textId(index = 0): string {
  const id = textElements()[index]?.dataset.textId;
  if (!id) throw new Error(`no text element at index ${index}`);
  return id;
}

export function textElement(index = 0): HTMLElement {
  const element = textElements()[index];
  if (!element) throw new Error(`no text element at index ${index}`);
  return element;
}

/** A piece of text's own words on the screen, before or after an edit. */
export function textElementById(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (!element) throw new Error(`no text element with id ${id}`);
  return element;
}

/** What a piece of text is drawn as, when it is not being typed into. */
export function drawnText(id: string): string {
  const element = textElementById(id).querySelector<HTMLElement>('[data-testid="text-content"]');
  if (!element) throw new Error(`text ${id} is not drawn as text`);
  return element.textContent ?? '';
}

/** The box a piece of text's element is drawn at, read off its inline style. */
export function drawnBox(id: string): { width: number; height: number } {
  const style = textElementById(id).style;
  return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
}

/** The text object's textarea, when one is open. */
export function textTextarea(): HTMLTextAreaElement {
  const element = screen.getByTestId('text-textarea');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('the text editor is not a textarea');
  return element;
}

export function hasTextTextarea(): boolean {
  return screen.queryByTestId('text-textarea') !== null;
}

/** Type into a piece of text, one character at a time, as a browser would. */
export function typeIntoText(text: string): void {
  const element = textTextarea();
  for (const character of text) {
    element.value = element.value + character;
    fireEvent.input(element);
  }
}

/** Replace everything a piece of text holds in one keystroke (stands in for a paste). */
export function pasteIntoText(text: string): void {
  const element = textTextarea();
  element.value = text;
  fireEvent.input(element);
}

/**
 * Lay text out with a font the test chooses, and give the board its own back afterwards.
 *
 * Called from a `describe` body, where it registers its own cleanup: a measurer left installed would be a
 * measurer the next test in this file, or the next file in this worker, measures with — which is a failure
 * that shows up somewhere with no obvious connection to the test that caused it.
 */
export function measureWith(measurer: TextMeasurer): void {
  setMeasurer(measurer);
  afterEach(() => {
    setMeasurer(null);
  });
}

/** The layout tests' fake: half a font size per character, on every machine. */
export function measureWithFakeFont(): void {
  measureWith(fakeMeasurer());
}

/** How wide one `characters`-letter line is in the fake font, in world units. */
export function fakeLineWidth(characters: number): number {
  return characters * TEXT_SIZES.M * TEXT_ESTIMATED_GLYPH_RATIO;
}

/** The padding a text box carries on each side, so a test can say "the words, plus the box". */
export const TEXT_BOX_PADDING = TEXT_PADDING_WORLD;

/** The measurer in force right now — the real one, or whatever a test put there. */
export { getMeasurer };

/**
 * Put a piece of text on the board directly.
 *
 * For tests about a text object rather than about the tool that places one: creating through the tool would
 * make those tests depend on the tool as well, and a failure in a test of the object's undo would then be
 * ambiguous about which of the two broke.
 */
export function addText(at: Point = { x: 100, y: 100 }, createdBy = 'g_test'): string {
  let id = '';
  act(() => {
    id = createText(doc(), at, createdBy) ?? '';
  });
  if (id === '') throw new Error('the board refused to create a text object');
  return id;
}

/** Arm the text tool with its keyboard key. */
export function pressTextKey(): void {
  fireEvent.keyDown(window, { key: 't' });
}

export function pressSelectKey(): void {
  fireEvent.keyDown(window, { key: 'v' });
}

/** Whether the board says the text tool is armed. */
export function textToolArmed(): boolean {
  return surface().dataset.textTool === 'armed';
}

/** Which toolbar button reads as pressed. */
export function pressedTool(): string | null {
  const pressed = screen
    .getAllByTestId(/tool-/)
    .find((element) => element.getAttribute('aria-pressed') === 'true');
  return pressed === undefined ? null : (pressed.getAttribute('aria-label') ?? '');
}

/**
 * Click the board with the text tool armed: the way a piece of text really gets made.
 *
 * Returns after the object exists and is open for typing, because that is what the tool promises — click,
 * then type — and a test that carried on before the edit opened would be typing into nothing.
 */
export async function clickBoardToText(at: Point = { x: 300, y: 200 }): Promise<string> {
  const before = new Set(texts().map((text) => text.id));
  pointerDown(surface(), at.x, at.y);
  upWindow(at);
  await waitFor(() => expect(hasTextTextarea()).toBe(true));
  const made = texts().filter((text) => !before.has(text.id));
  if (made.length !== 1) throw new Error(`a click should have made one text object, made ${made.length}`);
  return made[0].id;
}

/**
 * Put a piece of text down with the tool and leave it selected but not being typed in.
 *
 * The Escape is what a person does when they are done typing: it keeps the object selected, which is the
 * state most tests about selecting, sizing and dragging want to start from.
 */
export async function placeText(at: Point = { x: 300, y: 200 }, text = ''): Promise<string> {
  pressTextKey();
  const id = await clickBoardToText(at);
  if (text) typeIntoText(text);
  escapeFromText();
  await waitFor(() => expect(hasTextTextarea()).toBe(false));
  return id;
}

/** Escape out of a piece of text's editor. */
export function escapeFromText(): void {
  fireEvent.keyDown(textTextarea(), { key: 'Escape' });
}

/** Press a piece of text and let go: a selection. */
export function pressText(id: string, init: PointerEventInit = {}): Point {
  const at = pressOnText(id, init);
  upWindow(at, init);
  return at;
}

/** Press a piece of text and leave the pointer down. */
export function pressOnText(id: string, init: PointerEventInit = {}): Point {
  const at = textCentre(id);
  pointerDown(textElementById(id), at.x, at.y, init);
  return at;
}

/** Where the middle of a piece of text is on the screen, from the document's box and the camera. */
export function textCentre(id: string): Point {
  const text = textById(id);
  const box = textScreenRect(id);
  return { x: box.x + box.width / 2, y: box.y + text.height / 2 };
}

/** A piece of text's box in screen pixels. */
export function textScreenRect(id: string): { x: number; y: number; width: number; height: number } {
  const text = textById(id);
  const origin = worldToScreen(camera(), { x: text.x, y: text.y });
  return { x: origin.x, y: origin.y, width: text.width, height: text.height };
}

/** A screen point on a piece of text: its middle, or the middle of its east or west edge. */
export function pointOnText(id: string, where: 'centre' | 'e' | 'w' = 'centre'): Point {
  const box = textScreenRect(id);
  if (where === 'centre') return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { x: where === 'e' ? box.x + box.width : box.x, y: box.y + box.height / 2 };
}

/**
 * What the document recorded about a text object's box.
 *
 * The witness for Key decision 1: a box write is something only the client that changed the text does, so a
 * test needs to see the writes rather than the value — "the box is the right size" is true whether or not
 * this client wrote it, and the whole point is who wrote it.
 */
export interface BoxWrite {
  width: number;
  height: number;
  /** Whether this client's own origin was on the change. */
  local: boolean;
}

/** Watch one text object's box; {@link BoxLog} says what was written while it was watching. */
export interface BoxLog {
  writes: BoxWrite[];
  stop(): void;
}

export function watchBox(id: string): BoxLog {
  const objects = doc().getMap<Y.Map<unknown>>('objects');
  const object = objects.get(id);
  if (!object) throw new Error(`no object with id ${id} to watch`);

  const writes: BoxWrite[] = [];
  const listener = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction): void => {
    if (!event.keys.has('width') && !event.keys.has('height')) return;
    const width = object.get('width');
    const height = object.get('height');
    writes.push({
      width: typeof width === 'number' ? width : Number.NaN,
      height: typeof height === 'number' ? height : Number.NaN,
      local: transaction.local,
    });
  };

  object.observe(listener);
  return {
    writes,
    stop(): void {
      object.unobserve(listener);
    },
  };
}

/** Stop watching. Not required for correctness, and required for not leaking a listener per test. */
export function stopWatching(log: BoxLog): void {
  log.stop();
}

/** The box a piece of text of `lines` lines and `characters` letters should be measured to, in the fake font. */
export function fakeBox(characters: number, lines = 1): { width: number; height: number } {
  return {
    width: fakeLineWidth(characters) + TEXT_BOX_PADDING * 2,
    height: lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT,
  };
}

/** The handles the overlay is drawing, by their compass name. */
export function handleNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="resize-handle-"]')).map((element) =>
    (element.getAttribute('data-testid') ?? '').replace('resize-handle-', ''),
  );
}

/** A screen point in the middle of the board area. */
export function boardCentre(): Point {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** The world point the middle of the screen is looking at. */
export function centreWorld(): Point {
  return screenToWorld(camera(), boardCentre());
}

/**
 * A text object as the document holds it, rather than as a snapshot.
 *
 * The snapshot is the board's own view and has no `Y.Text` in it, so a test that wants to write into a piece
 * of text — as another client, which is most of what makes these tests worth having — has to go to the
 * document itself. It is also how a test gets at a text object that the board itself would not draw.
 */
export function textMap(id: string): Y.Map<unknown> {
  const object = doc().getMap<Y.Map<unknown>>('objects').get(id);
  if (!object) throw new Error(`no object with id ${id} on the board`);
  return object;
}

/** The words a piece of text holds, read out of the document rather than off the screen. */
export function textContent(id: string): string {
  const text = textMap(id).get('text');
  return text instanceof Y.Text ? text.toString() : '';
}

/** What a colleague typed, as far as this client is concerned: a remote change to the words. */
export function somebodyTypesInto(id: string, text: string, at?: number): void {
  somebodyElse((there) => {
    const object = there.getMap<Y.Map<unknown>>('objects').get(id);
    const ytext = object?.get('text');
    if (!(ytext instanceof Y.Text)) throw new Error(`no text with id ${id} to type into`);
    ytext.insert(at ?? ytext.length, text);
  });
}

/** A colleague taking an object out from under whoever is typing in it. */
export function somebodyDeletes(id: string): void {
  somebodyElse((there) => {
    there.getMap<Y.Map<unknown>>('objects').delete(id);
  });
}

/** A colleague resizing a piece of text: the fixed width arriving from the other side. */
export function somebodySetsBox(id: string, width: number, height: number): void {
  somebodyElse((there) => {
    const object = there.getMap<Y.Map<unknown>>('objects').get(id);
    object?.set('width', width);
    object?.set('height', height);
  });
}
