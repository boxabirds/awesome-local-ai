import { fireEvent, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { App } from '../../src/client/App';
import { renderBoard } from './boardHarness';

/** Mount the whole board over a document the test owns and can inspect. */
export const renderStickyBoard = (doc: Y.Doc) => renderBoard(<App doc={doc} />);

/** Create a note through the model, before or after rendering. */
export const seedNote = (
  doc: Y.Doc,
  at: { x: number; y: number },
  options: { color?: StickyColor; text?: string } = {},
): string => {
  const id = createSticky(doc, at, options.color);
  if (options.text) {
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const text = objects.get(id)?.get('text');
    if (text instanceof Y.Text) text.insert(0, options.text);
  }
  return id;
};

/** All note elements currently on the board. */
/** All note elements currently on the board (empty when there are none). */
export const noteElements = (): HTMLElement[] =>
  screen.queryAllByTestId('sticky-note') as HTMLElement[];

/** The element of one note, by id. */
export const noteElement = (id: string): HTMLElement => {
  const found = noteElements().find((element) => element.dataset.noteId === id);
  if (!found) throw new Error(`no note element for ${id}`);
  return found;
};

/** The notes the model currently holds. Reads the document, so it also works before render. */
export const modelNotes = (doc: Y.Doc): readonly StickySnapshot[] => snapshot(doc);

export const viewport = (): HTMLElement => screen.getByTestId('board-viewport') as HTMLElement;
export const world = (): HTMLElement => screen.getByTestId('world-layer') as HTMLElement;

const pointerInit = (x: number, y: number, pointerId: number, button = 0) => ({
  pointerId,
  pointerType: 'mouse',
  isPrimary: true,
  button,
  buttons: 1,
  clientX: x,
  clientY: y,
});

/** Press an element at a screen point. */
export const press = (element: Element, x: number, y: number, pointerId = 1): void => {
  fireEvent.pointerDown(element, pointerInit(x, y, pointerId));
};

export const moveTo = (element: Element, x: number, y: number, pointerId = 1): void => {
  fireEvent.pointerMove(element, { ...pointerInit(x, y, pointerId, -1), buttons: 1 });
};

export const release = (element: Element, x: number, y: number, pointerId = 1): void => {
  fireEvent.pointerUp(element, { ...pointerInit(x, y, pointerId), buttons: 0 });
};

export const cancelPointer = (element: Element, x: number, y: number, pointerId = 1): void => {
  fireEvent.pointerCancel(element, { ...pointerInit(x, y, pointerId), buttons: 0 });
};

/** A complete click: press and release at the same point. */
export const clickAt = (element: Element, x: number, y: number, pointerId = 1): void => {
  press(element, x, y, pointerId);
  release(element, x, y, pointerId);
};

/** Press and drag an element by (dx, dy) screen pixels, in a few steps. */
export const dragBy = (
  element: Element,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  pointerId = 1,
): void => {
  press(element, from.x, from.y, pointerId);
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    moveTo(element, from.x + (dx * step) / steps, from.y + (dy * step) / steps, pointerId);
  }
};

/** Note toolbar, or `null` when nothing is selected. */
export const toolbarElement = (): HTMLElement | null =>
  (screen.queryAllByTestId('note-toolbar')[0] as HTMLElement | undefined) ?? null;

export const swatch = (name: string): HTMLElement =>
  within(screen.getByTestId('note-toolbar')).getByTestId(`swatch-${name}`) as HTMLElement;

export const deleteButton = (): HTMLElement =>
  within(screen.getByTestId('note-toolbar')).getByTestId('note-toolbar-delete') as HTMLElement;

/** The floating textarea of the note being edited, or `null`. */
export const editorElement = (): HTMLElement | null =>
  (screen.queryAllByTestId('sticky-note-editor')[0] as HTMLElement | undefined) ?? null;

export const click = (element: HTMLElement): void => {
  fireEvent.click(element);
};

export const textOf = (element: HTMLElement): HTMLElement =>
  within(element).getByTestId('sticky-note-text') as HTMLElement;

/** Press a key that the window keyboard handler listens for (focus defaults to the body). */
export const pressKey = (key: string, target: Element = document.body): void => {
  fireEvent.keyDown(target, { key });
};

/** Type into an element the way a browser would: set the value, then fire `input`. */
export const typeInto = (element: HTMLElement, value: string): void => {
  fireEvent.input(element, { target: { value } });
};
