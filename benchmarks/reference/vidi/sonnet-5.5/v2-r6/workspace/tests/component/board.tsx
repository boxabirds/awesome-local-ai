import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import { BoardApp } from '../../src/client/App';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { flushFrame } from './helpers';

let current: Y.Doc | null = null;

function Harness() {
  const board = useBoardDoc();
  current = board.doc;
  return <BoardApp board={board} />;
}

export function renderBoard() {
  render(<Harness />);
  const doc = current as Y.Doc;
  return {
    doc,
    viewport: screen.getByTestId('board-viewport'),
    world: screen.getByTestId('board-world'),
  };
}

export function addNote(doc: Y.Doc, x: number, y: number): string {
  let id = '';
  act(() => { id = createSticky(doc, { x, y }) as string; });
  return id;
}

export const noteEl = (id: string): HTMLElement =>
  document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;

export const notes = (doc: Y.Doc) => snapshot(doc);

export function press(el: Element, x: number, y: number) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
}
export function moveTo(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function release(el: Element, x: number, y: number) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function click(el: Element, x = 0, y = 0) {
  press(el, x, y);
  release(el, x, y);
}

export async function drag(el: Element, from: [number, number], to: [number, number]) {
  press(el, ...from);
  moveTo(el, ...to);
  await flushFrame();
  release(el, ...to);
}
