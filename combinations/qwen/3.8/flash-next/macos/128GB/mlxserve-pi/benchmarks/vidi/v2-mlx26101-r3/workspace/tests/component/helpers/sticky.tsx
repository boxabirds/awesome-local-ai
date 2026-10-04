import { fireEvent, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../../src/client/App';
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
} from '../../../src/client/canvas/camera';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import { flushFrames, VIEWPORT } from '../helpers';
import { setObservedSize } from '../resizeObserver';

export interface PointerOptions {
  pointerId?: number;
  button?: number;
  pointerType?: 'mouse' | 'touch' | 'pen';
  /** Which buttons are still held down; the browser says so on every pointer event. */
  buttons?: number;
}

export interface MountedSticky {
  readonly view: RenderResult;
  /** The document the app renders: tests read it, and drive it, directly. */
  readonly doc: Y.Doc;
  readonly board: HTMLElement;
  camera(): Camera;
  notes(): readonly StickySnapshot[];
  note(index?: number): HTMLElement;
  noteCount(): number;
  textOf(index?: number): string;
  editor(): HTMLTextAreaElement;
  editorOrNull(): HTMLTextAreaElement | null;
  /** The visible text of a note (the fitted text element). */
  counter(): HTMLElement | null;
  fadeOrNull(): HTMLElement | null;
  toolbar(): HTMLElement;
  toolbarOrNull(): HTMLElement | null;
  /** Where a world point is drawn on screen, given the camera the app has now. */
  screenOf(point: Point): Point;
}

/**
 * Mount the whole app against a document the test can read and write, with the jsdom window
 * emulated at 1280x800 and the world layer reporting no transform of its own.
 *
 * `boardId` is left out unless a test needs the app to be connected to a room - which, in the
 * component suite, means it has stubbed `y-websocket` and wants to hand the app a close code.
 * Without it the app renders a board that syncs with nothing, which is every other test here.
 *
 * jsdom does not lay text out: `scrollHeight`/`clientHeight` are 0 and ranges return no
 * boxes. Anything that needs real glyph geometry (font fitting, caret line breaks) is left
 * to the Playwright tests.
 */
export async function mountSticky(
  doc: Y.Doc = new Y.Doc(),
  { boardId }: { boardId?: string } = {},
): Promise<MountedSticky> {
  setObservedSize(VIEWPORT);
  const view = render(<App doc={doc} boardId={boardId} />);
  await flushFrames(2);
  const board = view.getByTestId('board-viewport');
  const world = view.getByTestId('world-layer');

  const camera = (): Camera => {
    const raw = world.getAttribute('data-camera');
    if (raw === null) {
      throw new Error('world layer is missing its camera readout');
    }
    const [x, y, zoom] = raw.split(',').map(Number) as [number, number, number];
    return { x, y, zoom };
  };

  const editorOrNull = (): HTMLTextAreaElement | null =>
    view.container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-note-editor"]');

  return {
    view,
    doc,
    board,
    camera,
    notes: () => snapshot(doc),
    note: (index = 0): HTMLElement => {
      const elements = view.container.querySelectorAll<HTMLElement>('[data-sticky-note]');
      const element = elements[index];
      if (element === undefined) {
        throw new Error(`no sticky note at index ${index} (found ${elements.length})`);
      }
      return element;
    },
    noteCount: () => view.container.querySelectorAll('[data-sticky-note]').length,
    textOf: (index = 0): string => {
      const elements = view.container.querySelectorAll<HTMLElement>('.sticky-note__text');
      const element = elements[index];
      if (element === undefined) {
        throw new Error(`no note text element at index ${index}`);
      }
      return element.textContent ?? '';
    },
    editor: (): HTMLTextAreaElement => {
      const editor = editorOrNull();
      if (editor === null) {
        throw new Error('the note is not being edited (no textarea found)');
      }
      return editor;
    },
    editorOrNull,
    counter: () => view.container.querySelector<HTMLElement>('[data-testid="sticky-note-counter"]'),
    fadeOrNull: () =>
      view.container.querySelector<HTMLElement>('[data-testid="sticky-note-fade"]'),
    toolbar: (): HTMLElement => {
      const toolbar = view.container.querySelector<HTMLElement>('[data-testid="note-toolbar"]');
      if (toolbar === null) {
        throw new Error('no note toolbar is shown (is the note selected?)');
      }
      return toolbar;
    },
    toolbarOrNull: () =>
      view.container.querySelector<HTMLElement>('[data-testid="note-toolbar"]'),
    screenOf: (point: Point) => worldToScreen(camera(), point),
  };
}

/** The world point in the middle of what the user can see. */
export function viewCentreWorld(board: MountedSticky): Point {
  return screenToWorld(board.camera(), { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 });
}

function pointerInit(options: PointerOptions, point: Point, buttons: number): Record<string, unknown> {
  return {
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? 'mouse',
    buttons: options.buttons ?? buttons,
    clientX: point.x,
    clientY: point.y,
  };
}

export function press(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerDown(target, { ...pointerInit(options, point, 1), button: options.button ?? 0 });
}

export function moveTo(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerMove(target, pointerInit(options, point, 1));
}

export function release(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerUp(target, { ...pointerInit(options, point, 0), button: options.button ?? 0 });
}

export function cancelDrag(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerCancel(target, pointerInit(options, point, 0));
}

/**
 * The browser taking pointer capture away from the note. The button is still held down
 * (`buttons: 1`) in the case that matters: bringing a note to the front moves its element,
 * and Chromium answers that by ending the capture, mid-drag.
 */
export function loseCapture(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.lostPointerCapture(target, pointerInit(options, point, options.buttons ?? 1));
}

/** Press and release without moving: a click. */
export function clickAt(target: Element, point: Point, options: PointerOptions = {}): void {
  press(target, point, options);
  release(target, point, options);
}

/** A drag with the pointer: enough movement to cross the drag threshold on the way. */
export async function dragWithPointer(
  target: Element,
  from: Point,
  to: Point,
  options: PointerOptions = {},
): Promise<void> {
  press(target, from, options);
  moveTo(target, { x: from.x + 5, y: from.y }, options);
  moveTo(target, to, options);
  release(target, to, options);
  await flushFrames();
}

export function doubleClick(target: Element, point: Point, options: PointerOptions = {}): void {
  fireEvent.doubleClick(target, pointerInit(options, point, 0));
}

/**
 * Double-click empty board space at a world point. Returns the id of the note the app
 * created there, so a test can follow the note it just asked for.
 */
export async function doubleClickBoard(board: MountedSticky, world: Point): Promise<string> {
  const before = new Set(board.notes().map((note) => note.id));
  doubleClick(board.board, board.screenOf(world));
  await flushFrames();
  const added = snapshot(board.doc).find((note) => !before.has(note.id));
  if (added === undefined) {
    throw new Error('double-clicking empty board space added no note');
  }
  return added.id;
}

/** Keyboard as the user means it: no focused field, focus on the page itself. */
export function pressKey(key: string): void {
  fireEvent.keyDown(window, { key });
}

/**
 * A key pressed while a field has focus: the keydown starts on that element, which is where
 * the editor listens for Escape.
 */
export function pressKeyIn(target: Element, key: string): void {
  fireEvent.keyDown(target, { key });
}

/** Type into the editor the way a user does: the value grows, one change event per burst. */
export function typeInto(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: `${editor.value}${text}` } });
}

/** Replace the whole text, which is what a paste does. */
export function pasteInto(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: text } });
}

/** The centre of a note, read off the element the app drew. */
export function centreOf(note: HTMLElement): Point {
  return {
    x: Number.parseFloat(note.style.left) + STICKY_SIZE_WORLD / 2,
    y: Number.parseFloat(note.style.top) + STICKY_SIZE_WORLD / 2,
  };
}

export function positionOf(note: HTMLElement): { x: number; y: number } {
  return { x: Number.parseFloat(note.style.left), y: Number.parseFloat(note.style.top) };
}
