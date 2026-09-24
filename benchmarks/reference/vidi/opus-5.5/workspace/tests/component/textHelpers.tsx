/** Helpers for story 9 component tests (free text and tools) on the real board. */
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { isText, type TextSnapshot } from '../../src/shared/objects/text';
import { board, doc } from './stickyHelpers';

export const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;
/** Origin of changes made by "someone else" in these tests. */
export const REMOTE = 'remote-peer';

export function texts(): TextSnapshot[] {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks not installed');
  return hooks.getObjects().filter(isText);
}

export function onlyText(): TextSnapshot {
  const all = texts();
  if (all.length !== 1) throw new Error(`expected one text object, found ${all.length}`);
  return all[0]!;
}

export function selectedIds(): string[] {
  return window.__vidi6?.getSelection() ?? [];
}

export function textEls(): HTMLElement[] {
  return screen.queryAllByTestId('text-object');
}

export function textEl(id: string): HTMLElement {
  const el = textEls().find((e) => e.dataset.id === id);
  if (!el) throw new Error(`text ${id} not rendered`);
  return el;
}

export function textEditor(): HTMLTextAreaElement | null {
  return screen.queryByRole('textbox', { name: 'Text' });
}

export function toolButton(name: 'Select (V)' | 'Text (T)'): HTMLButtonElement {
  return screen.getByRole('button', { name });
}

export function pressKey(key: string, init: KeyboardEventInit = {}): boolean {
  return fireEvent.keyDown(window, { key, ...init });
}

/** Press and release on the board at screen point (x, y) (the Text tool creates on release). */
export function clickBoardAt(x: number, y: number, target: Element = board()): void {
  fireEvent.pointerDown(target, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: x, clientY: y });
  fireEvent.pointerUp(target, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: x, clientY: y });
}

/** T, then a click on the board: returns the new text's editor. */
export function createTextAt(x: number, y: number): HTMLTextAreaElement {
  pressKey('t');
  clickBoardAt(x, y);
  const el = textEditor();
  if (!el) throw new Error('new text is not being edited');
  return el;
}

/** Types `value` as the textarea's whole new content (one input event). */
export function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.change(textarea, { target: { value } });
}

/** Creates a text with `content`, ends editing with Escape; returns its id (selected). */
export function createSelectedText(content: string, x = 300, y = 200): string {
  const editorEl = createTextAt(x, y);
  typeInto(editorEl, content);
  fireEvent.keyDown(editorEl, { key: 'Escape' });
  return onlyText().id;
}

/** Changes the document the way another person's client would (not LOCAL_ORIGIN). */
export function remote(change: (d: Y.Doc) => void): void {
  act(() => {
    doc().transact(() => change(doc()), REMOTE);
  });
}
