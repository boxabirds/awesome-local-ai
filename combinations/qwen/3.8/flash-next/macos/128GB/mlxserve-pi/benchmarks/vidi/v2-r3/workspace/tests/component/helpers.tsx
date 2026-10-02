import { act, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';
import type { Doc } from 'yjs';
import { vi } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  createSticky,
  getStickyText,
  snapshot,
  snapshotAll,
  type StickySnapshot,
  type TextSnapshot,
} from '../../src/shared/board-model';
import { createCanvasMeasurer } from '../../src/client/objects/textLayout';
import { remeasureTextBox } from '../../src/client/objects/useTextBoxSync';
import { createText, getTextContent } from '../../src/shared/objects/text';
import { applyTextDiff } from '../../src/client/objects/StickyText';

/** jsdom component-test viewport (see setup.ts). */
export const VIEWPORT = { width: 1280, height: 800 };
export const CENTRED_TRANSFORM = `scale(1) translate(${VIEWPORT.width / 2}px, ${VIEWPORT.height / 2}px)`;
export const INITIAL_ZOOM_TRANSFORM = `scale(${ZOOM_STEP_FACTOR}) translate(${VIEWPORT.width / 2 / ZOOM_STEP_FACTOR}px, ${VIEWPORT.height / 2 / ZOOM_STEP_FACTOR}px)`;

/** Render the board UI (viewport + controls + hint wired together). Since
 *  story 5 `App` is the router, so a board-UI test renders `Board` directly. */
export function renderApp() {
  return render(<Board />);
}

/**
 * Render the board and capture its document through the board's test seam, so a
 * component test can create and delete notes with the real model while React
 * keeps rendering them.
 */
export function renderBoard(): Doc {
  let captured: Doc | null = null;
  render(<Board onDocReady={(doc: Doc) => {
    captured = doc;
  }} />);
  if (captured === null) throw new Error('Board did not expose its Y.Doc');
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

/* ── Free text (story 9) ──────────────────────────────────────────────── */

/** Create a text object through the model. Its top-left is the point given,
 *  which is where a text object belongs, unlike a note, which is centred. */
export function createTextObject(doc: Doc, x: number, y: number): string {
  let id = '';
  act(() => {
    id = createText(doc, { x, y }) ?? '';
  });
  if (id === '') throw new Error('the model refused to create a text object');
  return id;
}

/** Change a text object's text through the model, as the editor would: the text
 *  and the box the text needs, written together by the client that made the
 *  change, which is the rule the whole story turns on. */
export function setTextObjectText(doc: Doc, id: string, text: string): void {
  act(() => {
    const ytext = getTextContent(doc, id);
    if (ytext !== undefined) applyTextDiff(ytext, text, null);
    remeasureTextBox(doc, id, createCanvasMeasurer());
  });
}

export function textData(doc: Doc, id: string): TextSnapshot | undefined {
  const object = snapshotAll(doc).find((entry) => entry.id === id);
  return object !== undefined && object.type === 'text' ? object : undefined;
}

export function textEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-text-id]'));
}

export function textEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-text-id="${id}"]`);
  if (el === null) throw new Error(`text object ${id} is not rendered`);
  return el;
}

export function textCount(): number {
  return textEls().length;
}

/** The editor of one object, when it is open. */
export function editorOf(id: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(`[data-text-id="${id}"] textarea`);
  if (el === null) throw new Error(`text object ${id} is not being edited`);
  return el;
}

/** Begin editing an object the way a person does: a press that selects it and
 *  the second click that opens it. A real double-click is both, and the first
 *  half matters here, because the toolbar of the selected object is what the
 *  size and width buttons are on. */
export function openTextEditor(id: string): HTMLTextAreaElement {
  const el = textEl(id);
  pressOn(el, 100, 100);
  releaseOn(el, 100, 100);
  fireEvent.doubleClick(el, { clientX: 100, clientY: 100 });
  return editorOf(id);
}

/** Type into an open editor the way a browser does: value, then input. */
export function typeIntoText(id: string, value: string): void {
  fireEvent.input(editorOf(id), { target: { value } });
}

/** Count the transactions that changed a stored box, whoever asked for them. */
export function watchBoxWrites(doc: Doc): () => number {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  let writes = 0;
  objects.observeDeep((events) => {
    for (const event of events) {
      if (event.target === objects) continue;
      // A Y.Map event, whatever the type declarations choose to call it.
      const keys = (event as { changes?: { keys?: Map<string, unknown> } }).changes?.keys;
      if (keys === undefined) continue;
      if (keys.has('width') || keys.has('height')) writes += 1;
    }
  });
  return () => writes;
}

/** Bring a second document to this one's state, for a change from elsewhere. */
export function peerOf(doc: Doc): Doc {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  return peer;
}

/** Send a peer's changes into this document, as a sync message would: the
 *  transaction they arrive in is not a local one, which is the whole of what the
 *  board has to tell apart. */
export function applyRemote(doc: Doc, peer: Doc): void {
  act(() => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  });
}

/** A text object's Y.Text in a peer document, to write from the other side. */
export function peerText(peer: Doc, id: string): Y.Text {
  const map = peer.getMap<Y.Map<unknown>>('objects').get(id);
  const ytext = map?.get('text');
  if (!(ytext instanceof Y.Text)) throw new Error(`text object ${id} has no text`);
  return ytext;
}

/** Shift+press and shift+release: the way a second object is added to a
 *  selection, and the way a marquee is drawn without replacing what is chosen. */
export function shiftPressOn(el: Element, x = 100, y = 100): void {
  fireEvent.pointerDown(el, { ...POINTER, shiftKey: true, clientX: x, clientY: y });
}

export function shiftReleaseOn(el: Element, x = 100, y = 100): void {
  fireEvent.pointerUp(el, { ...POINTER, shiftKey: true, clientX: x, clientY: y });
}

/**
 * A drag of (dx, dy) screen pixels in steps, so the gesture is the one the board
 * actually recognizes: a press, moves past the drag threshold, a release. The
 * element that gets the moves is the one that got the press, which is what
 * pointer capture means in a browser.
 */
export function dragBy(
  el: Element,
  dx: number,
  dy: number,
  from: { x: number; y: number } = { x: 100, y: 100 },
  steps = 4,
): void {
  pressOn(el, from.x, from.y);
  for (let step = 1; step <= steps; step++) {
    moveTo(el, from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  releaseOn(el, from.x + dx, from.y + dy);
}

/** A frame of animation time, without React's act() around it: for the times a
 *  test wants a scheduled measurement to run and has changed no component itself. */
export function advance(ms = 100): void {
  vi.advanceTimersByTime(ms);
}
