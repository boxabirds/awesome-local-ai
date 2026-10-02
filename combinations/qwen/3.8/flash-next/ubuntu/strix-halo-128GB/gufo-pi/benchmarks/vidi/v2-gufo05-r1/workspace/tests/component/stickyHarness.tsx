/**
 * Shared harness for story 2's component tests: mounts the real `App` (camera,
 * viewport, toolbars, notes) in jsdom around a document the test owns, and
 * drives it with the pointer and keyboard events a user produces.
 *
 * jsdom has no layout: every element measures 0x0 and `getBoundingClientRect`
 * is the zero rect. The board's viewport is fixed at (0,0) and fills the window
 * (1024x768 here), so a client point equals a viewport point, and with the
 * camera at (0, 0, zoom 1) a screen point equals a world point too. Text
 * auto-fit and pixel positions are verified in the browser suite instead.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { createSticky, initDoc, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { screenToWorld, type Camera } from '../../src/client/canvas/camera';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

/** The camera the board opens with, and that the tests reset to. */
export const HOME_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

const FRAME_MS = 25;

/** Let scheduled animation frames (the drag's writes) run. */
export async function advanceFrames(frames = 2): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
    });
  }
}

export interface StickyAppHandle {
  doc: Y.Doc;
  /** The document's notes in stacking order, read straight from the model. */
  notes(): readonly StickySnapshot[];
  viewport(): HTMLElement;
  camera(): Camera;
  setCamera(partial: Partial<Camera>): Promise<void>;
  /** Note elements in stacking order. */
  noteElements(): HTMLElement[];
  note(index?: number): HTMLElement;
  /** Add a note through the model and let the board render it. */
  addNote(centre?: { x: number; y: number }): Promise<string>;
  press(target: Node | Window, x: number, y: number): Promise<void>;
  moveTo(x: number, y: number): Promise<void>;
  release(x: number, y: number): Promise<void>;
  /** Press and release in the same place: a click. */
  clickAt(x: number, y: number): Promise<void>;
  /** Two quick clicks on the board or on an element. */
  doubleClick(target: Node | Window, x: number, y: number): Promise<void>;
  /** Click empty board space (the viewport itself). */
  clickEmpty(x?: number, y?: number): Promise<void>;
  pressKey(key: string, target?: Node | Window, init?: { shift?: boolean }): Promise<void>;
  /** End the current press with pointercancel (the drag keeps its position). */
  cancel(): Promise<void>;
  /** The currently rendered note ids, in stacking order. */
  noteIds(): string[];
  /** The editor's textarea, when a note is being edited. */
  textarea(): HTMLTextAreaElement;
  /** Type as a user would: set the value, then fire `input`. */
  type(value: string): Promise<void>;
}

/** Mount the app around a given document. */
export async function renderStickyApp(doc: Y.Doc = new Y.Doc()): Promise<StickyAppHandle> {
  initDoc(doc);
  render(<App doc={doc} />);
  await advanceFrames();

  const api = () => window.__vidi6;

  /**
   * The element that received the last press: a real browser sends the rest of
   * the gesture there (pointer capture), so the harness routes it the same way.
   */
  let pressed: Node | Window | null = null;

  const press = async (target: Node | Window, x: number, y: number) => {
    pressed = target;
    await act(async () => {
      fireEvent.pointerDown(target, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: 1,
        isPrimary: true,
        pointerType: 'mouse',
      });
    });
  };

  const moveTo = async (x: number, y: number) => {
    const target = pressed ?? screen.queryByTestId('board-viewport');
    if (!target) throw new Error('nothing is pressed');
    await act(async () => {
      fireEvent.pointerMove(target, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        buttons: 1,
        isPrimary: true,
        pointerType: 'mouse',
      });
    });
    await advanceFrames(1); // the drag writes once per animation frame
  };

  const release = async (x: number, y: number) => {
    const target = pressed ?? screen.queryByTestId('board-viewport');
    if (!target) throw new Error('nothing is pressed');
    pressed = null;
    await act(async () => {
      fireEvent.pointerUp(target, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        button: 0,
        buttons: 0,
        isPrimary: true,
        pointerType: 'mouse',
      });
    });
    await advanceFrames(1);
  };

  const cancel = async () => {
    const target = pressed;
    pressed = null;
    if (!target) return;
    await act(async () => {
      fireEvent.pointerCancel(target, { pointerId: 1, buttons: 0 });
    });
    await advanceFrames(1);
  };

  const handle: StickyAppHandle = {
    doc,
    notes: () => snapshot(doc),
    viewport: () => screen.getByTestId('board-viewport'),
    camera: () => {
      const value = api()?.getCamera();
      if (!value) throw new Error('test camera api is missing');
      return value;
    },
    setCamera: async (partial) => {
      await act(async () => {
        api()?.setCamera(partial);
      });
      await advanceFrames();
    },
    noteElements: () => [...screen.getAllByTestId('sticky-note')] as HTMLElement[],
    note: (index = 0) => handle.noteElements()[index] as HTMLElement,
    addNote: async (centre = { x: 400, y: 300 }) => {
      let id = '';
      await act(async () => {
        id = createSticky(doc, centre);
      });
      await advanceFrames();
      return id;
    },
    press,
    moveTo,
    release,
    cancel,
    clickAt: async (x, y) => {
      await press(handle.viewport(), x, y);
      await release(x, y);
    },
    doubleClick: async (target, x, y) => {
      await act(async () => {
        fireEvent.doubleClick(target, { clientX: x, clientY: y, pointerId: 1, button: 0 });
      });
      await advanceFrames();
    },
    clickEmpty: async (x = 20, y = 20) => {
      await press(handle.viewport(), x, y);
      await release(x, y);
    },
    pressKey: async (key, target, init) => {
      await act(async () => {
        fireEvent.keyDown(target ?? window, { key, bubbles: true, shiftKey: init?.shift ?? false });
      });
      await advanceFrames();
    },
    noteIds: () => handle.notes().map((note) => note.id),
    textarea: () => screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement,
    type: async (value) => {
      await act(async () => {
        const element = handle.textarea();
        // Assign through the prototype setter: React tracks the value of an
        // uncontrolled textarea through an accessor of its own on the element,
        // so writing `element.value` directly would look like React's own write
        // and no `input` event would reach the component.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
        fireEvent.input(element);
      });
      await advanceFrames();
    },
  };

  return handle;
}

/** Centre of the jsdom window, i.e. the centre of the visible board area. */
export function viewportCentre(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/**
 * Where a screen point lands in world coordinates right now. The board opens
 * with the world origin in the middle of the window, so this is not the same as
 * the screen point itself.
 */
export function worldAt(board: StickyAppHandle, point: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return screenToWorld(board.camera(), point);
}

/** Where a note centred on `centre` is expected to be stored (top-left). */
export function expectedTopLeft(centre: { x: number; y: number }): { x: number; y: number } {
  const half = STICKY_SIZE_WORLD / 2;
  return { x: centre.x - half, y: centre.y - half };
}
