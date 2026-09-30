/**
 * Helpers for text object component tests.
 */
import { fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { createText, readTextSnapshot, type TextSnapshot } from '../../src/shared/objects/text';

/** Get the current doc from the test hooks. */
export function getDoc(): Y.Doc {
  const value = window.__vidi6?.getDoc?.();
  if (!value) throw new Error('window.__vidi6.getDoc is missing');
  return value;
}

/** Create a text object directly in the model (bypasses the tool). */
export function createTextObject(world: { x: number; y: number }): string {
  const doc = getDoc();
  const id = createText(doc, world, 'local')!;
  return id;
}

/** Create a text object with content. */
export function createTextWithContent(world: { x: number; y: number }, text: string): string {
  const id = createTextObject(world);
  const doc = getDoc();
  const objects = doc.getMap('objects');
  const entry = objects.get(id) as Y.Map<unknown>;
  const textVal = entry.get('text') as Y.Text;
  textVal.insert(0, text);
  return id;
}

/** Read text objects from the model. */
export function modelTextObjects(): TextSnapshot[] {
  const doc = getDoc();
  const objects = doc.getMap('objects');
  const result: TextSnapshot[] = [];
  for (const [id, entry] of objects) {
    if (!(entry instanceof Y.Map)) continue;
    const type = entry.get('type');
    if (type === 'text') {
      const snap = readTextSnapshot(id, entry);
      if (snap) result.push(snap);
    }
  }
  return result;
}

/** Count text objects rendered on screen. */
export function textObjectCount(): number {
  return screen.queryAllByTestId('text-object').length;
}

/** Get a text object element by index. */
export function textElement(index = 0): HTMLElement {
  const elements = screen.getAllByTestId('text-object') as HTMLElement[];
  return elements[index]!;
}

/** View the data attributes of a text object. */
export interface TextView {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: string;
  mode: string;
  selected: boolean;
  editing: boolean;
}

export function textView(index = 0): TextView {
  const el = textElement(index);
  return {
    id: el.dataset.textId ?? '',
    x: Number(el.dataset.textX),
    y: Number(el.dataset.textY),
    width: Number(el.dataset.textWidth),
    height: Number(el.dataset.textHeight),
    size: el.dataset.textSize ?? '',
    mode: el.dataset.textMode ?? '',
    selected: el.dataset.selected === 'true',
    editing: el.dataset.editing === 'true',
  };
}

/** Get the text editor textarea. */
export function textEditor(): HTMLTextAreaElement {
  return screen.getByTestId('text-editor') as HTMLTextAreaElement;
}

/** Type into the text editor. */
export function typeIntoTextEditor(text: string): void {
  fireEvent.change(textEditor(), { target: { value: text } });
}

/** Press Escape while editing. */
export function pressEscapeInEditor(): void {
  fireEvent.keyDown(textEditor(), { key: 'Escape' });
}

/** Double-click a text object to start editing. */
export function dblClickText(index = 0): void {
  const el = textElement(index);
  fireEvent.doubleClick(el);
}

/** Select a text object by clicking it. */
export function selectTextObject(index = 0): void {
  const el = textElement(index);
  // Click empty board first to clear selection
  const surface = screen.getByTestId('world-layer');
  fireEvent.pointerDown(surface, { clientX: 900, clientY: 100, pointerId: 9, button: 0 });
  fireEvent.pointerUp(surface, { clientX: 900, clientY: 100, pointerId: 9, button: 0 });
  // Click the text object
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
}

/** Get the text toolbar. */
export function getTextToolbar(): HTMLElement {
  return screen.getByTestId('text-toolbar');
}
