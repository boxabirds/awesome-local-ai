import { fireEvent, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../../src/client/App';
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
} from '../../../src/client/canvas/camera';
import {
  snapshot,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../../src/shared/config';
import type { Handle, Rect } from '../../../src/shared/geometry';
import { TESTBOX_TYPE } from '../../fixtures/testbox';
import { flushFrames, VIEWPORT } from '../helpers';
import { setObservedSize } from '../resizeObserver';

/**
 * Where a pointer event is fired. The app listens for moves and releases on `window`, because a
 * pointer that leaves the note mid-drag still has to be followed - so tests fire those events there,
 * exactly as the browser does.
 */
export type PointerTarget = Element | Document | Window;

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
  /** Every object on the board, whatever type it is, in draw order. */
  objects(): readonly ObjectSnapshot[];
  /** One object by id; throws when it is not there. */
  object(id: string): ObjectSnapshot;
  /** The note or box elements of a given object type. */
  elementsOf(type: string): HTMLElement[];
  /** The element an object is drawn in, by id: where a press on that object has to land. */
  element(id: string): HTMLElement;
  /** Where an object is, read off the element it is drawn in. */
  place(id: string): Rect;
  /** The sticky note at index `index`, whatever is drawn on top of it. */
  box(index?: number): HTMLElement;
  /** The selection bar, or null when the selection is too small for one. */
  barOrNull(): HTMLElement | null;
  /** The selection bar; throws when there is none. */
  bar(): HTMLElement;
  /** What the bar's live region says, or null when there is no bar. */
  barText(): string | null;
  /** The selection bar's Delete button; throws when there is no bar. */
  barDelete(): HTMLElement;
  /** How many objects are showing a selection outline. */
  outlineCount(): number;
  /** The ids the overlay has drawn an outline around. */
  outlinedIds(): string[];
  /** The bounding box around a whole selection, or null when there is no box. */
  boundsOrNull(): HTMLElement | null;
  /** The resize handles currently on screen, by their `data-handle`. */
  handleList(): HTMLElement[];
  /** One resize handle; throws when it is not on screen. */
  handle(handle: Handle): HTMLElement;
  /** The marquee rectangle, or null while nothing is being dragged around. */
  marqueeOrNull(): HTMLElement | null;
  /** How many objects the app says are being carried by a gesture. */
  draggingCount(): number;
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

  /**
   * The element an object is drawn in - the one a press on that object has to land on. The
   * outline drawn around a selected object carries the same id, so it is left out: pressing the
   * outline is not pressing the object.
   */
  const elementFor = (id: string): HTMLElement => {
    const found = view.container.querySelector<HTMLElement>(
      `[data-object-id="${id}"]:not(.selection-outline)`,
    );
    if (found === null) {
      throw new Error(`no element on the board for object ${id}`);
    }
    return found;
  };

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
    objects: () => snapshot(doc),
    object: (id: string): ObjectSnapshot => {
      const found = snapshot(doc).find((object) => object.id === id);
      if (found === undefined) {
        throw new Error(`no object with id ${id} on the board`);
      }
      return found;
    },
    // The outline drawn around a selected object names the same type, and is left out for the same
    // reason the outline itself is: it is a marking on top of the board, not an object.
    elementsOf: (type: string): HTMLElement[] => [
      ...view.container.querySelectorAll<HTMLElement>(
        `[data-object-type="${type}"]:not(.selection-outline)`,
      ),
    ],
    /**
     * The element an object is drawn in - the one a press on that object has to land on. The
     * outline drawn around a selected object carries the same id, so it is left out: pressing the
     * outline is not pressing the object.
     */
    element: elementFor,
    /** Where an object is, read off the element it is drawn in. */
    place: (id: string): Rect => {
      const element = elementFor(id);
      return {
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      };
    },
    box: (index = 0): HTMLElement => {
      const elements = [...view.container.querySelectorAll<HTMLElement>('[data-object-type]')].filter(
        (element) => element.classList.contains('sticky-note') || element.classList.contains('testbox'),
      );
      const element = elements[index];
      if (element === undefined) {
        throw new Error(`no board object at index ${index} (found ${elements.length})`);
      }
      return element;
    },
    barOrNull: () => view.container.querySelector<HTMLElement>('[data-testid="selection-bar"]'),
    bar(): HTMLElement {
      const bar = view.container.querySelector<HTMLElement>('[data-testid="selection-bar"]');
      if (bar === null) {
        throw new Error('no selection bar is shown (are two or more objects selected?)');
      }
      return bar;
    },
    barText: (): string | null =>
      view.container.querySelector<HTMLElement>('[data-testid="selection-count"]')?.textContent ??
      null,
    barDelete(): HTMLElement {
      const button = view.container.querySelector<HTMLElement>(
        '[data-testid="selection-delete"]',
      );
      if (button === null) {
        throw new Error('the selection bar has no Delete button');
      }
      return button;
    },
    outlineCount: () => view.container.querySelectorAll('[data-testid="selection-outline"]').length,
    outlinedIds: (): string[] =>
      [...view.container.querySelectorAll<HTMLElement>('[data-testid="selection-outline"]')].map(
        (element) => element.dataset.objectId ?? '',
      ),
    boundsOrNull: () => view.container.querySelector<HTMLElement>('[data-testid="selection-bounds"]'),
    handleList: (): HTMLElement[] => [
      ...view.container.querySelectorAll<HTMLElement>('[data-testid="resize-handle"]'),
    ],
    handle(handle: Handle): HTMLElement {
      const element = view.container.querySelector<HTMLElement>(
        `[data-testid="resize-handle"][data-handle="${handle}"]`,
      );
      if (element === null) {
        throw new Error(`no resize handle for ${handle} (is a resizable object selected?)`);
      }
      return element;
    },
    marqueeOrNull: () => view.container.querySelector<HTMLElement>('[data-testid="marquee"]'),
    draggingCount: () => view.container.querySelectorAll('[data-dragging="true"]').length,
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

export function press(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerDown(target, { ...pointerInit(options, point, 1), button: options.button ?? 0 });
}

export function moveTo(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerMove(target, pointerInit(options, point, 1));
}

export function release(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerUp(target, { ...pointerInit(options, point, 0), button: options.button ?? 0 });
}

export function cancelDrag(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerCancel(target, pointerInit(options, point, 0));
}

/**
 * The browser taking pointer capture away from the note. The button is still held down
 * (`buttons: 1`) in the case that matters: bringing a note to the front moves its element,
 * and Chromium answers that by ending the capture, mid-drag.
 */
export function loseCapture(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.lostPointerCapture(target, pointerInit(options, point, options.buttons ?? 1));
}

/** Press and release without moving: a click. */
export function clickAt(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  press(target, point, options);
  release(target, point, options);
}

/** A drag with the pointer: enough movement to cross the drag threshold on the way. */
export async function dragWithPointer(
  target: PointerTarget,
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

export function doubleClick(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
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
 * A shortcut: a key with modifiers, pressed while the page has focus. The board reads its
 * shortcuts off the window, the way a browser delivers them.
 *
 * The `code` is the physical key ('KeyZ'), because that is what the app matches on; the `key` is
 * worked out from it unless given, which is what lets a test press the same key with a capital on
 * it. What comes back is whether the app took the keystroke - `event.defaultPrevented` - which is
 * the difference between the app having done this thing and the app leaving the browser to it.
 */
export function pressCombo(
  code: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; key?: string } = {},
): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    key: mods.key ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code),
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** One of the toolbar's two history buttons; throws when the toolbar has none. */
function historyButton(board: MountedSticky, testId: string): HTMLElement {
  const button = board.view.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (button === null) {
    throw new Error(`the toolbar has no ${testId} button`);
  }
  return button;
}

/** The toolbar's Undo button. */
export function undoButton(board: MountedSticky): HTMLElement {
  return historyButton(board, 'undo');
}

/** The toolbar's Redo button. */
export function redoButton(board: MountedSticky): HTMLElement {
  return historyButton(board, 'redo');
}

/**
 * Whether the toolbar says the button would do nothing. `aria-disabled` rather than `disabled`,
 * because a button that is not there at all cannot tell you why it is not there.
 */
export function isDisabled(button: HTMLElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

/** Press the toolbar's Undo button. */
export function clickUndo(board: MountedSticky): void {
  fireEvent.click(undoButton(board));
}

/** Press the toolbar's Redo button. */
export function clickRedo(board: MountedSticky): void {
  fireEvent.click(redoButton(board));
}

/** What the toolbar's Undo button offers to take back, or why it offers nothing. */
export function undoTitle(board: MountedSticky): string {
  return undoButton(board).title;
}

/** What the toolbar's Redo button offers to put back. */
export function redoTitle(board: MountedSticky): string {
  return redoButton(board).title;
}

/**
 * A key pressed while a field has focus: the keydown starts on that element, which is where
 * the editor listens for Escape, and for the undo shortcut it keeps for itself.
 *
 * Whether the field's own handler took the keystroke - whether something along the way called
 * `preventDefault` - so a test can tell "the editor did this" apart from "this fell through to the
 * window, and something else did". Same sense as `pressCombo`.
 */
export function pressKeyIn(
  target: PointerTarget,
  key: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): boolean {
  const prevented = !fireEvent.keyDown(target, {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });
  return prevented;
}

/** Type into the editor the way a user does: the value grows, one change event per burst. */
export function typeInto(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: `${editor.value}${text}` } });
}

/** Replace the whole text, which is what a paste does. */
export function pasteInto(editor: HTMLTextAreaElement, text: string): void {
  fireEvent.change(editor, { target: { value: text } });
}

/** The centre of an object, read off the element the app drew - so it is right for an object
that has been resized, not only for a note of the size it was made at. */
export function centreOf(note: HTMLElement): Point {
  const width = Number.parseFloat(note.style.width);
  const height = Number.parseFloat(note.style.height);
  return {
    x: Number.parseFloat(note.style.left) + (Number.isFinite(width) ? width : STICKY_SIZE_WORLD) / 2,
    y: Number.parseFloat(note.style.top) + (Number.isFinite(height) ? height : STICKY_SIZE_WORLD) / 2,
  };
}

/** The middle of the box an object is drawn in, from the document. */
export function centreOfObject(object: ObjectSnapshot): Point {
  return { x: object.x + object.width / 2, y: object.y + object.height / 2 };
}

/** Where an object's centre is on the screen, given the camera the app has now. */
export function centreOnScreen(board: MountedSticky, object: ObjectSnapshot): Point {
  return board.screenOf(centreOfObject(object));
}

/**
 * Shift + drag across empty board space: the marquee. The press lands on the board surface
 * (given an element of its own, use `shiftDragFrom`), the box grows as it goes.
 */
export async function shiftDrag(
  board: MountedSticky,
  from: Point,
  to: Point,
  steps = 2,
): Promise<void> {
  const target = board.board;
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    shiftKey: true,
    clientX: from.x,
    clientY: from.y,
  });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.pointerMove(target, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      shiftKey: true,
      clientX: from.x + ((to.x - from.x) * step) / steps,
      clientY: from.y + ((to.y - from.y) * step) / steps,
    });
  }
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    shiftKey: true,
    clientX: to.x,
    clientY: to.y,
  });
  await flushFrames();
}

/** Shift + drag whose press lands on a particular element (the object type's own element). */
export function shiftPress(target: PointerTarget, point: Point, options: PointerOptions = {}): void {
  fireEvent.pointerDown(target, {
    ...pointerInit(options, point, 1),
    button: 0,
    shiftKey: true,
  });
}

/** The testboxes on the board, by id, in draw order. */
/** The test type's elements: the boxes themselves, not the markings drawn over them. */
export function testboxElements(view: RenderResult): HTMLElement[] {
  return [
    ...view.container.querySelectorAll<HTMLElement>(
      `[data-object-type="${TESTBOX_TYPE}"]:not(.selection-outline)`,
    ),
  ];
}

export function positionOf(note: HTMLElement): { x: number; y: number } {
  return { x: Number.parseFloat(note.style.left), y: Number.parseFloat(note.style.top) };
}
