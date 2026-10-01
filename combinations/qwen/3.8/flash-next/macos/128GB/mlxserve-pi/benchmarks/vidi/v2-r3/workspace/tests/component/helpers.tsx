import { act, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Doc } from 'yjs';
import { vi } from 'vitest';
import { App } from '../../src/client/App';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { createSticky, getStickyText, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { applyTextDiff } from '../../src/client/objects/StickyText';

/** jsdom component-test viewport (see setup.ts). */
export const VIEWPORT = { width: 1280, height: 800 };
export const CENTRED_TRANSFORM = `scale(1) translate(${VIEWPORT.width / 2}px, ${VIEWPORT.height / 2}px)`;
export const INITIAL_ZOOM_TRANSFORM = `scale(${ZOOM_STEP_FACTOR}) translate(${VIEWPORT.width / 2 / ZOOM_STEP_FACTOR}px, ${VIEWPORT.height / 2 / ZOOM_STEP_FACTOR}px)`;

/** Render the whole app (viewport + controls + hint wired together). */
export function renderApp() {
  return render(<App />);
}

/**
 * Render the app and capture its board document through the app's test seam,
 * so a component test can create and delete notes with the real model while
 * React keeps rendering them.
 */
export function renderBoard(): Doc {
  let captured: Doc | null = null;
  render(<App onDocReady={(doc: Doc) => {
    captured = doc;
  }} />);
  if (captured === null) throw new Error('App did not expose its Y.Doc');
  return captured;
}

/** Create a note through the model (wrapped in act for React's observer). */
export function createNote(doc: Doc, x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y });
  });
  return id;
}

/** Replace a note's text through the model, as the editor would. */
export function setNoteText(doc: Doc, id: string, text: string): void {
  act(() => {
    const ytext = getStickyText(doc, id);
    if (ytext !== undefined) applyTextDiff(ytext, text, null);
  });
}

export function noteData(doc: Doc, id: string): StickySnapshot | undefined {
  return snapshot(doc).find((note) => note.id === id);
}

export function noteEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-note-id]'));
}

export function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (el === null) throw new Error(`note ${id} is not rendered`);
  return el;
}

const POINTER = { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0 };

export function pressOn(el: Element, x = 100, y = 100): void {
  fireEvent.pointerDown(el, { ...POINTER, clientX: x, clientY: y });
}

export function moveTo(el: Element, x: number, y: number): void {
  fireEvent.pointerMove(el, { ...POINTER, clientX: x, clientY: y });
}

export function releaseOn(el: Element, x = 100, y = 100): void {
  fireEvent.pointerUp(el, { ...POINTER, clientX: x, clientY: y });
}

export function cancelPressOn(el: Element): void {
  fireEvent.pointerCancel(el, { ...POINTER });
}

/** Type into the note's textarea the way a browser does: value, then input. */
export function typeInto(el: Element, value: string): void {
  fireEvent.input(el, { target: { value } });
}

export function textareaEl(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('textarea');
  if (el === null) throw new Error('no text editor is open');
  return el;
}

/** Number of notes the board renders. */
export function noteCount(): number {
  return noteEls().length;
}

export function renderWith(ui: ReactNode) {
  return render(ui);
}

/**
 * The camera coalesces updates with requestAnimationFrame; vitest fake
 * timers fake rAF, so tests advance time inside act() to flush one frame.
 */
export function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

export function surfaceOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
}

export function worldLayerOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
}

export function zoomLabelOf(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>('[data-testid="zoom-label"]')!;
}

export const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
