import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';

export function renderApp(doc: Y.Doc = new Y.Doc()) {
  initDoc(doc);
  const result = render(<App doc={doc} />);
  return {
    ...result,
    doc,
    viewport: screen.getByTestId('board-viewport'),
    user: userEvent.setup({ delay: null }),
  };
}

/** A doc with one note centred on world (0, 0), optionally with text. */
export function docWithNote(text = '') {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 }) as string;
  if (text) getStickyText(doc, id)!.insert(0, text);
  return { doc, id };
}

export const noteElements = () => screen.queryAllByRole('group', { name: 'Sticky note' });
export const noteEl = () => screen.getByRole('group', { name: 'Sticky note' });
export const noteToolbar = () => screen.queryByRole('toolbar', { name: 'Note toolbar' });
export const editor = () => screen.queryByRole('textbox', { name: 'Note text' });

export function press(el: Element, x = 100, y = 100) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}
export function moveTo(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function release(el: Element, x = 100, y = 100) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

/** Press and release on the same spot (a click without dragging). */
export function click(el: Element, x = 100, y = 100) {
  press(el, x, y);
  release(el, x, y);
  fireEvent.click(el, { clientX: x, clientY: y });
}

export function selectNote() {
  click(noteEl());
  return noteEl();
}

export function notesOf(doc: Y.Doc) {
  return snapshot(doc);
}
