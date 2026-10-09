/**
 * Helpers for story 9's component tests: the text tool, text objects, and the text toolbar.
 *
 * Text objects are created the way the board creates them — the Text tool and a click on
 * empty board — whenever the test is about that click, and straight into the document
 * (`seedText`) whenever the test only needs a text object to be there, because the position a
 * click lands at is the camera's business and not the test's.
 *
 * They are typed against the same DOM the sticky note helpers use, including `[data-note-id]`,
 * which is how the board says "an object is here" whatever type it is.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { objectSnapshots } from '../../../src/shared/board-model';
import { TEXT_MAX_CHARS, TEXT_SIZES } from '../../../src/shared/config';
import {
  createText,
  getTextContent,
  isTextSnapshot,
  readText,
  setTextSize,
  TEXT_TYPE,
  type TextSize,
  type TextSnapshot,
} from '../../../src/shared/objects/text';
import type { Rect } from '../../../src/shared/geometry';
import {
  boardDoc,
  flushFrames,
  pressKey,
  readCamera,
  screenPointOf,
  viewportElement,
} from './board';

/** A point on empty board: no note, no toolbar, no zoom controls, no first-use hint. */
export const EMPTY_BOARD = { x: 200, y: 600 };

interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------------- *
 * Creating and finding text objects
 * ------------------------------------------------------------------------ */

/**
 * Switch to the Text tool with the keyboard, as the PRD describes it, and wait for the button
 * to say it is on.
 */
export async function pressTextTool(): Promise<void> {
  await pressKey('t');
  await vi.waitFor(() => {
    if (textToolButton().getAttribute('aria-pressed') !== 'true') {
      throw new Error('the Text tool button is not pressed');
    }
  });
  await flushFrames();
}

/**
 * The Text tool, then a click on empty board: the text object is created there and its editor
 * is focused. Resolves to the new object's id.
 */
export async function createTextWithTool(at: Point = EMPTY_BOARD): Promise<string> {
  await pressTextTool();
  const before = textIdsInDoc();
  clickViewport(at);
  await vi.waitFor(() => {
    const created = textIdsInDoc().filter((id) => !before.includes(id));
    if (created.length !== 1) throw new Error(`expected 1 new text object, got ${created.length}`);
  });
  await vi.waitFor(() => {
    if (document.activeElement?.getAttribute('data-testid') !== 'text-editor') {
      throw new Error('the new text object is not being edited');
    }
  });
  const [id] = textIdsInDoc().filter((candidate) => !before.includes(candidate));
  if (!id) throw new Error('no new text object');
  return id;
}

/** A text object written straight into the document, as if another browser had made it. */
export async function seedText(
  at: Point = { x: -440, y: 200 },
  content = '',
  size: TextSize = 'M',
): Promise<string> {
  let id = '';
  act(() => {
    const created = createText(boardDoc(), at, 'tester');
    if (created === null) throw new Error('the text object was refused');
    id = created;
    if (size !== 'M') setTextSize(boardDoc(), created, size);
    if (content.length > 0) {
      const ytext = getTextContent(boardDoc(), created);
      if (!ytext) throw new Error('no shared text for the new object');
      ytext.insert(0, content);
    }
  });
  await waitForTextElement(id);
  return id;
}

/** Wait for the board to draw this many objects, of any type. */
export async function waitForObjects(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (objectSnapshots(boardDoc()).length !== count) {
      throw new Error(`the document has ${objectSnapshots(boardDoc()).length} objects`);
    }
  });
  await flushFrames();
}

/** Ids of every text object in the document. */
export function textIdsInDoc(): string[] {
  return objectSnapshots(boardDoc())
    .filter(isTextSnapshot)
    .map((object) => object.id);
}

/** What the document holds for one text object. */
export function textInDoc(id: string): TextSnapshot {
  const text = readText(boardDoc(), id);
  if (!text) throw new Error(`no text object with id ${id} in the document`);
  return text;
}

export function textRect(id: string): Rect {
  const text = textInDoc(id);
  return { x: text.x, y: text.y, width: text.width, height: text.height };
}

export function textSize(id: string): TextSize {
  return textInDoc(id).size;
}

export function textWidthMode(id: string): string {
  return textInDoc(id).widthMode;
}

export function textContentOf(id: string): string {
  return textInDoc(id).text;
}

/** The character box the document holds for a text object. */
export function textCharBox(id: string): { width: number; height: number } {
  const text = textInDoc(id);
  return { width: Math.round(text.width), height: Math.round(text.height) };
}

/* ------------------------------------------------------------------------- *
 * The DOM
 * ------------------------------------------------------------------------ */

export function textToolButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-testid="tool-text"]');
  if (!element) throw new Error('no Text tool button');
  return element;
}

export function selectToolButton(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('[data-testid="tool-select"]');
  if (!element) throw new Error('no Select tool button');
  return element;
}

export function toolPressed(): string | null {
  for (const [name, button] of [
    ['select', selectToolButton()],
    ['text', textToolButton()],
  ] as const) {
    if (button.getAttribute('aria-pressed') === 'true') return name;
  }
  return null;
}

/** Press the Text tool button itself, which TC-14 needs to work as well as the keyboard. */
export async function clickTextToolButton(): Promise<void> {
  const button = textToolButton();
  const at = { x: 16, y: 68 };
  pointerDownOnElement(button, at);
  button.click();
  pointerUpOnElement(button, at);
  await flushFrames();
}

/** Every text object the board drew. */
export function textElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[data-note-type="${TEXT_TYPE}"]`),
  );
}

export function textElement(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-note-type="${TEXT_TYPE}"][data-note-id="${id}"]`,
  );
  if (!element) throw new Error(`no text object element for id ${id}`);
  return element;
}

/** What the board draws for a text object when it is not being edited. */
export function textContentElement(id: string): HTMLElement {
  const element = textElement(id).querySelector<HTMLElement>('[data-testid="text-content"]');
  if (!element) throw new Error(`no rendered text for ${id}`);
  return element;
}

export function textEditorElement(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('[data-testid="text-editor"]');
  if (!element) throw new Error('no text editor');
  return element;
}

export function textToolbarSizeButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-testid="text-sizes"] button'),
  );
}

export function sizeButton(size: TextSize): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[data-testid="text-size-${size}"]`);
  if (!element) throw new Error(`no ${size} size button`);
  return element;
}

export function pressedSizeButtons(): TextSize[] {
  return (['S', 'M', 'L', 'XL'] as const satisfies readonly TextSize[]).filter(
    (size) => sizeButton(size).getAttribute('aria-pressed') === 'true',
  );
}

/** The size keys the toolbar offers, left to right. */
export const SIZE_BUTTON_KEYS = ['S', 'M', 'L', 'XL'] as const;

/** Every font size the settings define, smallest first, in pixels. */
export const FONT_SIZES_PX = (['S', 'M', 'L', 'XL'] as const).map((size) => TEXT_SIZES[size]);

export const MAX_CHARS = TEXT_MAX_CHARS;

/** Wait for the board to hold this many text objects. */
export async function waitForTexts(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (textIdsInDoc().length !== count) {
      throw new Error(`expected ${count} text objects, found ${textIdsInDoc().length}`);
    }
  });
  await flushFrames();
}

/* ------------------------------------------------------------------------- *
 * Typing
 * ------------------------------------------------------------------------ */

/**
 * Type into the text object's editor, the way a keyboard does: one `input` event per call,
 * which is what the shared text is bound to.
 */
export function typeIntoTextEditor(text: string): void {
  const editor = textEditorElement();
  act(() => {
    editor.value += text;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => undefined);
}

/**
 * Escape with the caret in the text object: editing ends and the object stays selected, and a
 * text with nothing in it is removed as it ends (TC-20).
 */
export async function finishEditing(): Promise<void> {
  const editor = textEditorElement();
  pressKey('Escape', editor);
  await flushFrames();
  await vi.waitFor(() => {
    if (document.querySelector('[data-testid="text-editor"]')) {
      throw new Error('the text editor is still open');
    }
  });
  await flushFrames();
}

/* ------------------------------------------------------------------------- *
 * Pointers
 * ------------------------------------------------------------------------ */

/** A plain left-button press, move and release on the viewport element itself. */
export function clickViewport(at: Point): void {
  const element = viewportElement();
  dispatchOn(element, 'pointerdown', at);
  dispatchOn(element, 'pointerup', at);
}

export function pointerDownOnElement(element: Element, at: Point): void {
  dispatchOn(element, 'pointerdown', at);
}

export function pointerUpOnElement(element: Element, at: Point): void {
  dispatchOn(element, 'pointerup', at);
}

function dispatchOn(
  element: Element,
  type: 'pointerdown' | 'pointerup',
  at: Point,
): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: at.x,
      clientY: at.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

/** Where a world point is on screen, for pressing a text object that lives at a known place. */
export function worldOnScreen(world: Point): Point {
  return screenPointOf(readCamera(), world);
}

/** Wait for a text object to appear in the document. */
export async function waitForText(id: string): Promise<void> {
  await vi.waitFor(() => {
    if (!textIdsInDoc().includes(id)) throw new Error(`text object ${id} is not in the document`);
  });
  await flushFrames();
}

/** Wait for the board to draw a text object. */
export async function waitForTextElement(id: string): Promise<void> {
  await vi.waitFor(() => {
    textElement(id);
  });
  await flushFrames();
}

