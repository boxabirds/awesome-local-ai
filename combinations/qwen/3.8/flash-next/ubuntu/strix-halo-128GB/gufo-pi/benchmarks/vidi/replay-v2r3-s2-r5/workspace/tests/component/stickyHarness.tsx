import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createBoardStore, type BoardStore } from '../../src/client/board/useBoardDoc';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/** Renders the real App against a fresh in-memory board document. */
export function renderBoard(): { store: BoardStore; doc: Y.Doc } {
  const store = createBoardStore();
  render(<App store={store} />);
  return { store, doc: store.doc };
}

export function addNote(doc: Y.Doc, at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at);
  });
  return id;
}

export function addNotes(
  doc: Y.Doc,
  count: number,
  at: { x: number; y: number } = { x: 0, y: 0 },
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(addNote(doc, { x: at.x + i * 400, y: at.y }));
  return ids;
}

export function notesOf(doc: Y.Doc) {
  return snapshot(doc);
}

export function noteById(id: string): HTMLElement {
  const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement | null;
  if (!el) throw new Error(`note ${id} is not rendered`);
  return el;
}

export function noteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-note-id]')) as HTMLElement[];
}

export function noteTextLayer(id: string): HTMLElement {
  const el = noteById(id).querySelector('[data-testid="sticky-note-text"]') as HTMLElement | null;
  if (!el) throw new Error('note text layer not found');
  return el;
}

export function gridLayer(): HTMLElement {
  const el = document.querySelector('[data-grid-layer="true"]') as HTMLElement | null;
  if (!el) throw new Error('grid layer not found');
  return el;
}

export function worldLayerTransform(): string {
  const el = document.querySelector('[data-testid="world-layer"]') as HTMLElement | null;
  if (!el) throw new Error('world layer not found');
  return el.style.transform;
}

const POINTER = { pointerId: 1, pointerType: 'mouse' as const, button: 0, buttons: 1 };

export function press(el: HTMLElement, x: number, y: number): void {
  fireEvent.pointerDown(el, { ...POINTER, clientX: x, clientY: y });
}

export function moveTo(el: HTMLElement, x: number, y: number): void {
  fireEvent.pointerMove(el, { ...POINTER, clientX: x, clientY: y });
}

export function release(el: HTMLElement, x: number, y: number): void {
  fireEvent.pointerUp(el, { ...POINTER, buttons: 0, clientX: x, clientY: y });
}

export function cancel(el: HTMLElement, x: number, y: number): void {
  fireEvent.pointerCancel(el, { ...POINTER, buttons: 0, clientX: x, clientY: y });
}

/** Press and release on empty board space (the grid layer). */
export function clickEmptyBoard(x = 10, y = 10): void {
  const el = gridLayer();
  press(el, x, y);
  release(el, x, y);
}

/** Let rAF-coalesced drag writes land. */
export async function flushFrames(count = 3): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
  }
}

export function textOf(doc: Y.Doc, id: string): string {
  const value = getStickyText(doc, id)?.toString();
  return value ?? '';
}

export const NOTE_HALF = STICKY_SIZE_WORLD / 2;

export { act, fireEvent, screen, waitFor };
