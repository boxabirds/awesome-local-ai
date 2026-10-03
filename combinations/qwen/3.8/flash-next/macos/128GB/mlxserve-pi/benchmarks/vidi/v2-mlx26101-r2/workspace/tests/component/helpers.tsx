import { act, cleanup, fireEvent, render } from '@testing-library/react';

import * as Y from 'yjs';

import { App } from '../../src/client/App.js';
import type { StickySnapshot } from '../../src/shared/board-model.js';
import type { Camera, Point } from '../../src/client/canvas/camera.js';
import { worldToScreen, zoomAt } from '../../src/client/canvas/camera.js';
import { STICKY_SIZE_WORLD } from '../../src/shared/config.js';
import { drainFrames } from './setup.js';

/** Board area used by component tests (the design's default laptop size). */
export const VIEWPORT = { width: 1280, height: 800 };

/** The standard view: 100% zoom with the board's start centred in the area. */
export const STANDARD_VIEW: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

/** A drag of 200 px right and 100 px down (the PRD's verification). */
export const DRAG: Point = { x: 200, y: 100 };
/** A pointer position away from the centre, used for zoom-at-pointer tests. */
export const POINTER: Point = { x: 300, y: 200 };
/** The centre of the board area: keyboard/button zoom is anchored here. */
export const CENTRE: Point = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
/** Where the wheel gesture is delivered when a test does not say otherwise. */
export const WHEEL_POINT: Point = CENTRE;

/** Zoom about the viewport centre, as the zoom buttons and shortcuts do. */
export const centreZoom = (cam: Camera, factor: number): Camera => zoomAt(cam, CENTRE, factor);

export const board = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="board-viewport"]')!;
export const worldLayer = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-testid="world-layer"]')!;
export const zoomLabel = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="zoom-label"]')!;

/**
 * Camera updates are batched onto the next animation frame (design
 * "camera.hook"), so every dispatched interaction advances that frame before
 * the test looks at the DOM.
 */
function settle(): void {
  act(() => {
    drainFrames();
  });
}

/** Advance the frame queue so queued camera updates are rendered. */
export function flushFrames(): void {
  settle();
}

export function renderApp(): void {
  // Tests that loop over several renders would otherwise stack containers.
  cleanup();
  act(() => {
    render(<App />);
  });
  flushFrames();
}

/** The camera the app currently holds (test hook, present in test mode). */
export function camera(): Camera {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hooks are not registered');
  return hooks.getCamera();
}

/** Read the rendered world layer transform back into a camera. */
export function renderedCamera(): Camera {
  const match = /scale\(([-0-9.e+]+)\)\s+translate\(([-0-9.e+]+)px,\s*([-0-9.e+]+)px\)/u.exec(
    worldLayer().style.transform,
  );
  if (!match) throw new Error(`unexpected world transform: ${worldLayer().style.transform}`);
  return { x: -Number(match[2]), y: -Number(match[3]), zoom: Number(match[1]) };
}

/** The rendered dot grid: screen spacing and the phase of the lattice. */
export function grid(): { spacing: number; offsetX: number; offsetY: number } {
  const style = board().style;
  const [sizeX] = style.backgroundSize.split(' ');
  const [posX, posY] = style.backgroundPosition.split(' ');
  const spacing = parseFloat(sizeX ?? '');
  const offsetX = parseFloat(posX ?? '');
  const offsetY = parseFloat(posY ?? '0');
  if (!Number.isFinite(spacing) || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    throw new Error(`unexpected grid style: ${style.backgroundSize} / ${style.backgroundPosition}`);
  }
  return { spacing, offsetX, offsetY };
}

const POINTER_ID = 1;

export function pointerDown(p: Point, element: Element = board()): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerMove(p: Point, element: Element = board()): void {
  fireEvent.pointerMove(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    buttons: 1,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerUp(p: Point, element: Element = board()): void {
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function pointerCancel(p: Point, element: Element = board()): void {
  fireEvent.pointerCancel(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export function lostPointerCapture(p: Point, element: Element = board()): void {
  fireEvent.lostPointerCapture(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: p.x,
    clientY: p.y,
  });
  settle();
}

export interface WheelInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  point?: Point;
  /** Set false to leave the queued frame undrained (frame batching tests). */
  flush?: boolean;
}

/** Dispatch a cancelable wheel event; check `event.defaultPrevented`. */
export function wheelEvent({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  ctrlKey = false,
  metaKey = false,
  point = { x: 640, y: 400 },
  flush = true,
}: WheelInit, element: Element = board()): Event {
  const event = new WheelEvent('wheel', {
    deltaX,
    deltaY,
    deltaMode,
    ctrlKey,
    metaKey,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  if (flush) settle();
  return event;
}

/** Dispatch a Safari gesture event (GestureEvent does not exist in jsdom). */
export function gestureEvent(
  type: 'gesturestart' | 'gesturechange' | 'gestureend',
  scale: number,
  point: Point = { x: 640, y: 400 },
  element: Element = board(),
): Event {
  const event = new MouseEvent(type, {
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'scale', { configurable: true, value: scale });
  element.dispatchEvent(event);
  settle();
  return event;
}

/** Dispatch a keydown on window (the shortcuts are listened to there). */
export function keydown(
  key: string,
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; flush?: boolean } = {},
): Event {
  const { flush = true } = modifiers;
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  // A shortcut can change board content, and a content change reaches React
  // through the document subscription - which only flushes inside act().
  act(() => {
    window.dispatchEvent(event);
  });
  if (flush) settle();
  return event;
}

/* --------------------------------------------------------- sticky notes */

/** The document the rendered app is using (test hook). */
export function boardDoc(): Y.Doc {
  const hooks = window.__vidi6Board;
  if (!hooks) throw new Error('board test hooks are not registered');
  const doc = hooks.getDoc();
  if (!doc) throw new Error('the app has no board document');
  return doc;
}

/** The notes as the model sees them, in drawing order (z, then id). */
export function docNotes(): readonly StickySnapshot[] {
  const hooks = window.__vidi6Board;
  if (!hooks) throw new Error('board test hooks are not registered');
  return hooks.getNotes();
}

export function noteElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

/** The nth note as drawn (0 is the bottom-most). */
export function noteElement(index = 0): HTMLElement {
  const elements = noteElements();
  const element = elements[index];
  if (!element) throw new Error(`no note rendered at position ${index} of ${elements.length}`);
  return element;
}

export function noteData(index = 0): StickySnapshot {
  const notes = docNotes();
  const note = notes[index];
  if (!note) throw new Error(`no note in the document at position ${index} of ${notes.length}`);
  return note;
}

export function noteId(index = 0): string {
  return noteData(index).id;
}

/** The note's text as the document holds it. */
export function noteText(index = 0): string {
  return noteData(index).text;
}

/** The note's text as the board draws it (not while editing: then the editor holds it). */
export function renderedNoteText(index = 0): string {
  const text = noteElement(index).querySelector<HTMLElement>('[data-testid="sticky-text"]');
  if (!text) throw new Error('the note renders no text');
  return text.textContent ?? '';
}

export function editor(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"]');
  if (!element) throw new Error('no note is being edited');
  return element;
}

/** The id of the note the app holds selected, read from the rendered notes. */
export function selectedNoteId(): string | null {
  const selected = noteElements().find((note) => note.dataset.selected === 'true');
  return selected?.dataset.noteId ?? null;
}

export function editingNoteId(): string | null {
  const editing = noteElements().find((note) => note.dataset.editing === 'true');
  return editing?.dataset.noteId ?? null;
}

/** Click the Sticky note button in the left toolbar. */
export function clickStickyButton(): void {
  const button = document.querySelector<HTMLElement>('[data-testid="create-sticky-button"]');
  if (!button) throw new Error('the toolbar has no Sticky note button');
  fireEvent.click(button);
  settle();
}

/** Double-click the board surface itself (empty board space). */
export function doubleClickBoard(point: Point = CENTRE): void {
  fireEvent.doubleClick(board(), { clientX: point.x, clientY: point.y });
  settle();
}

/** A click on empty board space: pointerdown, pointerup and the click itself. */
export function clickBoard(point: Point = { x: 40, y: 700 }): void {
  pointerDown(point, board());
  pointerUp(point, board());
  fireEvent.click(board(), { clientX: point.x, clientY: point.y });
  settle();
}

/**
 * Type into the open editor. The editor is uncontrolled and reads the textarea's
 * own value, so this is what a keystroke does: the browser changes the value,
 * then fires `input`.
 */
export function typeText(value: string): void {
  const element = editor();
  element.value = value;
  fireEvent.input(element, { target: { value } });
  settle();
}

/** Add characters at the end, as typing them would. */
export function typeMore(value: string): void {
  typeText(editor().value + value);
}

/** Text as the open editor holds it. */
export function editorValue(): string {
  return editor().value;
}

/**
 * Drag a note: press on it, move in `steps` equal steps, release. Each step
 * drains the animation frame, which is how the app batches writes (one per
 * frame).
 */
export function dragNote(
  from: Point,
  to: Point,
  element: Element = noteElement(0),
  steps = 4,
): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  settle();
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    fireEvent.pointerMove(element, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + (to.x - from.x) * t,
      clientY: from.y + (to.y - from.y) * t,
    });
    settle();
  }
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  settle();
}

/** Press and release on a note without moving (a select). */
export function pressNote(at: Point = { x: 100, y: 100 }, element: Element = noteElement(0)): void {
  fireEvent.pointerDown(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: at.x,
    clientY: at.y,
  });
  settle();
  fireEvent.pointerUp(element, {
    pointerId: POINTER_ID,
    pointerType: 'mouse',
    button: 0,
    clientX: at.x,
    clientY: at.y,
  });
  settle();
}

export function noteToolbarElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="note-toolbar"]');
}

export function colorSwatch(color: string): HTMLElement {
  const swatch = document.querySelector<HTMLElement>(`[data-testid="sticky-color-${color}"]`);
  if (!swatch) throw new Error(`the note toolbar has no ${color} swatch`);
  return swatch;
}

export function binButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>('[data-testid="delete-note"]');
  if (!button) throw new Error('the note toolbar has no delete button');
  return button;
}

/** A note plus its toolbar button, ready for a test about an existing note. */
export function createNote(text = ''): string {
  clickStickyButton();
  const id = noteId(0);
  if (text !== '') typeText(text);
  return id;
}

/**
 * Press a key while a specific element has focus: the event is dispatched on
 * that element and bubbles to the window, which is what a browser does. (The
 * `keydown` helper above dispatches on the window itself, for a shortcut that
 * belongs to the page.)
 */
export function pressKey(key: string, element: Element | Window = window): Event {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  // act(), because the keystroke is handled by React and changes React state:
  // without it the re-render is left queued and the test would read the DOM of
  // the previous state.
  act(() => {
    element.dispatchEvent(event);
  });
  settle();
  return event;
}

/** A pointer press and release on an element at the same point (a select). */
export function pressAt(at: Point, element: Element): void {
  pointerDown(at, element);
  pointerUp(at, element);
}

/** Leave editing through the editor itself (Escape). */
export function escapeFromEditor(): void {
  pressKey('Escape', editor());
}

/** Create a note, type into it, and stop editing: the note ends up selected. */
export function createSelectedNote(text = 'Retro board'): string {
  clickStickyButton();
  if (text !== '') typeText(text);
  escapeFromEditor();
  return noteId(0);
}

/**
 * Where the middle of a note is on screen, in viewport coordinates: what a test
 * has to press to grab that note. Derived from the document and the camera, so a
 * test that drags does not have to re-derive the geometry itself.
 */
export function noteScreenCentre(index = 0): Point {
  const note = noteData(index);
  return worldToScreen(camera(), {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  });
}

/** Double-click a specific element (an element other than the board surface). */
export function doubleClick(element: Element, point: Point = CENTRE): void {
  fireEvent.doubleClick(element, { clientX: point.x, clientY: point.y });
  settle();
}
