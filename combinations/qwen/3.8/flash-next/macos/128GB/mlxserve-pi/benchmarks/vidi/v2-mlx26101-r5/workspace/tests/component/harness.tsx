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
import { useCamera, type CameraController, type CameraPatch } from '../../src/client/canvas/useCamera';

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

export function pointer(
  type: PointerType,
  target: HTMLElement,
  point: Partial<Point> & { pointerId?: number },
): void {
  const finished = type === 'pointerUp' || type === 'pointerCancel';
  fireEvent[type](target, {
    pointerId: point.pointerId ?? 1,
    isPrimary: true,
    pointerType: 'mouse',
    button: 0,
    buttons: finished ? 0 : 1,
    clientX: point.x ?? 0,
    clientY: point.y ?? 0,
  });
}

/** Drags the board surface by (dx, dy) screen pixels. */
export function dragBy(dx: number, dy: number, from: Point = { x: 400, y: 300 }, pointerId = 1): void {
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

import type * as Y from 'yjs';

import { STICKY_SIZE_WORLD } from '../../src/shared/config';

import type { StickyColor } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  getStickyText,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { Selection } from '../../src/client/board/useSelection';
import { Board, type BoardHandle } from '../../src/client/App';

/** The whole board, plus the pieces a test needs to look inside it. */
export interface BoardFixture {
  /** Filled in on every render by `Board`. */
  handle: { current: BoardHandle | null };
  doc(): Y.Doc;
  notes(): readonly StickySnapshot[];
  selection(): Selection;
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
}

/** Renders the real `Board` (viewport, toolbars, notes, keyboard) at a fixed size. */
export function renderBoard(viewport: Size = VIEWPORT): BoardFixture {
  const handle: { current: BoardHandle | null } = { current: null };
  render(<Board handle={handle} viewport={viewport} />);

  const fixture: BoardFixture = {
    handle,
    doc: () => mustHandle(handle).doc,
    notes: () => mustHandle(handle).notes,
    selection: () => mustHandle(handle).selection,
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
