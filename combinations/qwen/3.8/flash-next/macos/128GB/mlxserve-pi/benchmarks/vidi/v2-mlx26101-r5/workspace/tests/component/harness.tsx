import { act, fireEvent, render, screen } from '@testing-library/react';

import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  useCamera,
  type CameraController,
  type CameraPatch,
} from '../../src/client/canvas/useCamera';

/** Laptop viewport from the design's fixtures. */
export const VIEWPORT: Size = { width: 1280, height: 800 };
export const DRAG_DX = 200;
export const DRAG_DY = 100;
export const POINTER: Point = { x: 300, y: 200 };
export const WHEEL_DELTA = 100;
export const WORLD_DIGITS = 6;
export const PERCENT = 100;
export const INITIAL_ZOOM = 1;
/** Frame wait long enough for the queued requestAnimationFrame to run. */
export const FRAME_MS = 40;

export interface Handle {
  current: CameraController | null;
}

/**
 * App-shaped harness: one `useCamera` shared by the board viewport, the zoom
 * controls and the navigation hint, exactly as `App.tsx` wires them.
 */
export function BoardHarness({
  viewport = VIEWPORT,
  handle,
}: {
  viewport?: Size;
  handle: Handle;
}): React.JSX.Element {
  const controller = useCamera(viewport);
  handle.current = controller;
  const { camera } = controller;
  return (
    <div className="vidi6-app">
      <BoardViewport controller={controller} />
      <ZoomControls
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onReset={controller.reset}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        zoomPercent={zoomPercent(camera)}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}

/** Renders the harness and returns the handle to its camera controller. */
export function renderHarness(viewport: Size = VIEWPORT): Handle {
  const handle: Handle = { current: null };
  render(<BoardHarness handle={handle} viewport={viewport} />);
  return handle;
}

export function board(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

export function worldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

export function zoomLabel(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

/** Camera as currently rendered into the DOM. */
export function renderedCamera(): Camera {
  const values = board().dataset;
  return {
    x: Number(values['cameraX']),
    y: Number(values['cameraY']),
    zoom: Number(values['cameraZoom']),
  };
}

/** Waits for the camera update queued on requestAnimationFrame to render. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
  });
}

/** Jumps the camera somewhere else, as the e2e test hook does. */
export async function setCamera(handle: Handle, patch: CameraPatch): Promise<void> {
  await act(async () => {
    handle.current?.setCamera(patch);
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
  });
}

type PointerType = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

/** Where the pointer is, and which keys were held down while it was there. */
export type PointerInit = Partial<Point> & {
  pointerId?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

export function pointer(type: PointerType, target: HTMLElement, point: PointerInit): void {
  const finished = type === 'pointerUp' || type === 'pointerCancel';
  fireEvent[type](target, {
    pointerId: point.pointerId ?? 1,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    buttons: finished ? 0 : 1,
    clientX: point.x ?? 0,
    clientY: point.y ?? 0,
    // Story 7 is the story where the modifiers matter: Shift selects as well as, and a test has to
    // be able to say which of the board's gestures was pulled with it held down.
    shiftKey: point.shiftKey ?? false,
    ctrlKey: point.ctrlKey ?? false,
    metaKey: point.metaKey ?? false,
    altKey: point.altKey ?? false,
  });
}

/** Drags the board surface by (dx, dy) screen pixels. */
export function dragBy(
  dx: number,
  dy: number,
  from: Point = { x: 400, y: 300 },
  pointerId = 1,
): void {
  const el = board();
  pointer('pointerDown', el, { ...from, pointerId });
  pointer('pointerMove', el, { x: from.x + dx, y: from.y + dy, pointerId });
  pointer('pointerUp', el, { x: from.x + dx, y: from.y + dy, pointerId });
}

export function dispatchWheel(
  target: HTMLElement,
  options: {
    deltaX?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    point?: Point;
    deltaMode?: number;
  },
): Event {
  const event = new window.WheelEvent('wheel', {
    deltaX: options.deltaX ?? 0,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    clientX: options.point?.x ?? 0,
    clientY: options.point?.y ?? 0,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Safari's non-standard pinch event. */
export function dispatchGesture(target: HTMLElement, scale: number, prevScale?: number): Event {
  const event = new window.Event('gesturechange', { bubbles: true, cancelable: true });
  Object.assign(event, { scale, prevScale, clientX: POINTER.x, clientY: POINTER.y });
  target.dispatchEvent(event);
  return event;
}

/** Ctrl/Cmd keyboard shortcut on the window; false means preventDefault ran. */
export function pressKey(key: string, modifier: 'ctrlKey' | 'metaKey' = 'ctrlKey'): boolean {
  return fireEvent.keyDown(window, { key, [modifier]: true });
}

/* ------------------------------------------------------------------ story 2 helpers */

import * as Y from 'yjs';

import { STICKY_SIZE_WORLD } from '../../src/shared/config';

import type { StickyColor } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  isStickySnapshot,
  OBJECTS_MAP,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { Marquee } from '../../src/client/board/Marquee';
import { worldToScreen } from '../../src/client/canvas/camera';
import type { ConnectBoardOptions } from '../../src/client/board/connection';
import { Board, type BoardHandle } from '../../src/client/board/Board';

/** The whole board, plus the pieces a test needs to look inside it. */
export interface BoardFixture {
  /** Filled in on every render by `Board`. */
  handle: { current: BoardHandle | null };
  doc(): Y.Doc;
  notes(): readonly StickySnapshot[];
  selection(): SelectionView;
  /** Creates a note through the model, centred on a world point. */
  create(x?: number, y?: number, color?: StickyColor): Promise<string>;
  /** Writes note text through the shared `Y.Text`, as an edit would. */
  setText(id: string, text: string): Promise<void>;
  /** Deletes a note through the model, as another client would. */
  delete(id: string): Promise<boolean>;
  /** The note's element, or null when it is gone. */
  noteEl(id: string): HTMLElement | null;
  /** Numbers read back from the note element's data attributes. */
  noteBox(id: string): { x: number; y: number; z: number; color: string; selected: boolean };
  textArea(): HTMLTextAreaElement;

  /* ---- story 7: the board as a board, not as a bag of notes ---- */

  /** Every object on the board, of every type this build can read, in stacking order. */
  objects(): readonly ObjectSnapshot[];
  /** The element of any object, not only a note: what a registry that drew nothing leaves is null. */
  objectEl(id: string): HTMLElement | null;
  /** The rectangle an object's element says it occupies, read from its data attributes. */
  boundsOf(id: string): { x: number; y: number; width: number; height: number; z: number };
  /** The selection bar, or null when the selection is too small for one. */
  barEl(): HTMLElement | null;
  /** What the selection bar says, e.g. `4 selected`. */
  barText(): string | null;
  /** The delete button in the selection bar, or null. */
  barDelete(): HTMLElement | null;
  /** The selection overlay's box, or null when nothing is selected. */
  overlayEl(): HTMLElement | null;
  /** The resize handles currently offered, by compass label. */
  handles(): string[];
  /** The marquee rectangle, or null while nobody is pulling one. */
  marqueeEl(): HTMLElement | null;
  /** The marquee's rectangle in world units, as the element reports it. */
  marqueeRect(): { x: number; y: number; width: number; height: number } | null;
  /** The board's marquee, for a test that wants the state rather than the drawing. */
  marquee(): Marquee;
  /** Shift-drags a rectangle on the board surface, and returns when it has landed. */
  selectByMarquee(from: Point, to: Point, pointerId?: number): Promise<void>;
  /** Shift-clicks an object: it joins the selection, or leaves it. */
  shiftClick(id: string, point?: Point): Promise<void>;
  /** Presses, moves and releases on an object, in screen coordinates. */
  dragObject(id: string, from: Point, to: Point, pointerId?: number): Promise<void>;
  /** Pulls a resize handle of the selection's box, in screen coordinates. */
  dragHandle(
    handle: string,
    from: Point,
    to: Point,
    pointerId?: number,
    modifier?: PointerInit,
  ): Promise<void>;
  /** Presses an object and holds the pointer there, without moving it. */
  press(id: string, point?: Point, modifier?: PointerInit): Promise<void>;
  /** Selects every object the way the keyboard does. */
  selectAll(modifier?: 'ctrlKey' | 'metaKey'): Promise<void>;
  /**
   * Writes an object into the document without going through the model — the way an object arrives
   * that this build's model did not write: a type from a later story, or one that was never registered
   * here at all. One transaction, because that is how a document change arrives.
   */
  seedObject(id: string, fields: Record<string, unknown>): Promise<void>;
  /** Where an object is on the screen, as the camera the board is drawing says. */
  screenOf(id: string): Point;
  /** A world point as the point on the screen it is drawn at. */
  screen(world: Point): Point;
}

/**
 * The selection as a test sees it. `selectedId` is a question the story 2 tests ask — "is this the one
 * that is selected?" — and the story 7 selection is a set, so the answer is derived here rather than
 * stored in the source, where nothing needs it.
 */
export interface SelectionView {
  /** Every selected object id. */
  ids: ReadonlySet<string>;
  /** How many objects are in the selection. */
  size: number;
  /** The object whose editing surface is open, or null. */
  editingId: string | null;
  /** The only object selected, or null when none or several are. */
  selectedId: string | null;
}

/** Renders the real `Board` (viewport, toolbars, notes, keyboard) at a fixed size. */
export function renderBoard(
  viewport: Size = VIEWPORT,
  board: { boardId?: string; connect?: ConnectBoardOptions } = {},
): BoardFixture {
  const handle: { current: BoardHandle | null } = { current: null };
  render(
    <Board handle={handle} viewport={viewport} boardId={board.boardId} connect={board.connect} />,
  );

  const fixture: BoardFixture = {
    handle,
    doc: () => mustHandle(handle).doc,
    notes: () => mustHandle(handle).snapshot.filter(isStickySnapshot),
    selection: () => {
      const selection = mustHandle(handle).selection;
      const only = selection.ids.size === 1 ? [...selection.ids][0] ?? null : null;
      return { ids: selection.ids, size: selection.ids.size, editingId: selection.editingId, selectedId: only };
    },
    create: async (x = 0, y = 0, color?: StickyColor) => {
      let id = '';
      await act(async () => {
        const created = createSticky(fixture.doc(), { x, y }, color);
        if (typeof created !== 'string') throw new Error('createSticky was rejected');
        id = created;
        await nextFrame();
      });
      return id;
    },
    setText: async (id: string, text: string) => {
      await act(async () => {
        const ytext = getStickyText(fixture.doc(), id);
        if (!ytext) throw new Error('note has no text');
        ytext.delete(0, ytext.length);
        ytext.insert(0, text);
        await nextFrame();
      });
    },
    delete: async (id: string) => {
      let removed = false;
      await act(async () => {
        removed = deleteObject(fixture.doc(), id);
        await nextFrame();
      });
      return removed;
    },
    noteEl: (id: string) => document.querySelector<HTMLElement>(`[data-note-id="${id}"]`),
    // jsdom has no layout, so the note's position is read from the data
    // attributes React renders from the document, not from a bounding box.
    noteBox: (id: string) => {
      const el = fixture.noteEl(id);
      if (!el) throw new Error('note is not rendered');
      return {
        x: Number(el.dataset['x']),
        y: Number(el.dataset['y']),
        z: Number(el.dataset['z']),
        color: String(el.dataset['color']),
        selected: el.dataset['selected'] === 'true',
      };
    },
    textArea: () => screen.getByTestId('sticky-editor') as HTMLTextAreaElement,

    objects: () => mustHandle(handle).snapshot,
    // Any object, not only a note: an object this build cannot draw has no element at all, and a
    // test that asks for it gets null, which is the truth about the registry.
    objectEl: (id: string) => document.querySelector<HTMLElement>('[data-object-id="' + id + '"]'),
    boundsOf: (id: string) => {
      const el = fixture.objectEl(id);
      if (!el) throw new Error('object is not rendered');
      return {
        x: Number(el.dataset['x']),
        y: Number(el.dataset['y']),
        width: Number(el.dataset['width']),
        height: Number(el.dataset['height']),
        z: Number(el.dataset['z']),
      };
    },
    barEl: () => screen.queryByTestId('selection-bar'),
    barText: () => screen.queryByTestId('selection-count')?.textContent ?? null,
    barDelete: () => screen.queryByTestId('delete-selection'),
    overlayEl: () => screen.queryByTestId('selection-overlay'),
    handles: () =>
      [...document.querySelectorAll<HTMLElement>('[data-handle]')].map((el) => String(el.dataset['handle'])),
    marqueeEl: () => screen.queryByTestId('marquee'),
    marqueeRect: () => {
      const el = screen.queryByTestId('marquee');
      if (!el) return null;
      return {
        x: Number(el.dataset['x']),
        y: Number(el.dataset['y']),
        width: Number(el.dataset['width']),
        height: Number(el.dataset['height']),
      };
    },
    marquee: () => mustHandle(handle).marquee,
    selectByMarquee: async (from, to, pointerId = 1) => {
      const surface = screen.getByTestId('board-viewport');
      pointer('pointerDown', surface, { ...from, pointerId, shiftKey: true });
      pointer('pointerMove', surface, { ...to, pointerId, shiftKey: true });
      await act(nextFrame);
      pointer('pointerUp', surface, { ...to, pointerId, shiftKey: false });
      await act(nextFrame);
    },
    shiftClick: async (id, point = { x: 0, y: 0 }) => {
      const el = fixture.objectEl(id);
      if (!el) throw new Error('object is not rendered');
      pointer('pointerDown', el, { ...point, shiftKey: true });
      pointer('pointerUp', el, { ...point, shiftKey: true });
      await act(nextFrame);
    },
    dragObject: async (id, from, to, pointerId = 1) => {
      const el = fixture.objectEl(id);
      if (!el) throw new Error('object is not rendered');
      pointer('pointerDown', el, { ...from, pointerId });
      pointer('pointerMove', el, { ...to, pointerId });
      await act(nextFrame);
      pointer('pointerMove', el, { ...to, pointerId });
      pointer('pointerUp', el, { ...to, pointerId });
      await act(nextFrame);
    },
    dragHandle: async (name, from, to, pointerId = 1, modifier = {}) => {
      const el = document.querySelector<HTMLElement>('[data-handle="' + name + '"]');
      if (!el) throw new Error('handle is not rendered');
      pointer('pointerDown', el, { ...from, pointerId, ...modifier });
      pointer('pointerMove', el, { ...to, pointerId, ...modifier });
      await act(nextFrame);
      pointer('pointerUp', el, { ...to, pointerId, ...modifier });
      await act(nextFrame);
    },
    press: async (id, point = { x: 0, y: 0 }, modifier = {}) => {
      const el = fixture.objectEl(id);
      if (!el) throw new Error('object is not rendered');
      pointer('pointerDown', el, { ...point, ...modifier });
      await act(nextFrame);
    },
    selectAll: async (modifier = 'metaKey') => {
      await act(async () => {
        fireEvent.keyDown(window, { key: 'a', [modifier]: true });
        await nextFrame();
      });
    },
    seedObject: async (id: string, fields: Record<string, unknown>) => {
      await act(async () => {
        const doc = fixture.doc();
        const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
        doc.transact(() => {
          const map = new Y.Map<unknown>();
          for (const [key, value] of Object.entries(fields)) map.set(key, value);
          objects.set(id, map);
        });
        await nextFrame();
      });
    },
    screen: (world: Point) => worldToScreen(renderedCamera(), world),
    screenOf: (id: string) => {
      const box = fixture.boundsOf(id);
      return worldToScreen(renderedCamera(), {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
    },
  };
  return fixture;
}

function mustHandle(handle: { current: BoardHandle | null }): BoardHandle {
  if (!handle.current) throw new Error('Board did not publish its handle');
  return handle.current;
}

/** Lets the queued requestAnimationFrame and re-render land. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FRAME_MS);
  });
}

/** Re-exported so a test file has one import for everything it does to the board. */
export { act };

/** Presses, moves and releases on an element; returns nothing. */
export async function dragOn(
  target: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerId = 1,
): Promise<void> {
  pointer('pointerDown', target, { ...from, pointerId });
  pointer('pointerMove', target, { ...to, pointerId });
  await act(nextFrame);
  pointer('pointerUp', target, { ...to, pointerId });
  await act(nextFrame);
}

/** Clicks an element with the mouse (pointerdown + pointerup, no movement). */
export async function click(target: HTMLElement, point = { x: 0, y: 0 }): Promise<void> {
  pointer('pointerDown', target, point);
  pointer('pointerUp', target, point);
  await act(nextFrame);
}

/** Types into the note editor the way the browser does: one input event. */
export async function type(text: string): Promise<void> {
  const el = screen.getByTestId('sticky-editor');
  const value = `${textValue(el)}${text}`;
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    await nextFrame();
  });
}

/** Replaces the editor's value and fires one input event (a paste does this). */
export async function setInput(value: string): Promise<void> {
  const el = screen.getByTestId('sticky-editor');
  await act(async () => {
    fireEvent.change(el, { target: { value } });
    await nextFrame();
  });
}

function textValue(el: Element): string {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : '';
}

/** Text of a note as stored in the document. */
export function noteText(fixture: BoardFixture, id: string): string {
  return getStickyText(fixture.doc(), id)?.toString() ?? '';
}

/** Where a note centred on a world point starts, as the model stores it. */
export const centredOn = (x: number, y: number): { x: number; y: number } => ({
  x: x - STICKY_SIZE_WORLD / 2,
  y: y - STICKY_SIZE_WORLD / 2,
});

/** Double-clicks an element at a screen point. */
export function doubleClick(target: HTMLElement, point = { x: 0, y: 0 }): void {
  fireEvent.dblClick(target, { clientX: point.x, clientY: point.y, button: 0 });
}
