// Shared helpers for story 7 component tests: the whole board rendered in jsdom
// against a doc the test can write to, plus the pointer vocabulary the selection
// machinery answers to (press, shift-press, drag, marquee drag, handle drag) and
// the DOM questions it has to answer (what is selected, what the bar says, which
// handles exist).
//
// The camera starts at the identity in jsdom (the viewport has no layout size),
// so screen pixels and world units are the same number here; a test that wants a
// different zoom sets one through the zoom controls.
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { NullProvider } from './story5TestUtils.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  createSticky,
  objectsMapOf,
  objectsSnapshot,
  resizeObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import type { Rect } from '../../src/shared/geometry.ts';
import { STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config.ts';
import '../fixtures/testbox.tsx'; // registers the test-only object type

const TEST_BOARD_ID = newBoardId();

export interface Seed {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
  z?: number;
}

export interface Board7Harness {
  view: RenderResult;
  doc(): Y.Doc;
  provider(): NullProvider;
  viewport(): HTMLElement;
  worldLayer(): HTMLElement;
  cam(): { x: number; y: number; zoom: number };
  /** sticky notes, in z order */
  notes(): HTMLElement[];
  note(i: number): HTMLElement;
  /** testboxes (the test-only resizable, non aspect-locked type), in z order */
  boxes(): HTMLElement[];
  box(i: number): HTMLElement;
  object(id: string): HTMLElement | null;
  /** objects carrying data-selected="true" */
  selected(): HTMLElement[];
  selectedIds(): string[];
  /** the selection overlay's outlines (screen-space divs), by object id */
  outline(id: string): HTMLElement | null;
  selectionCount(): string | null;
  barDeleteButton(): HTMLElement | null;
  noteToolbar(): HTMLElement | null;
  handles(): HTMLElement[];
  handle(name: string): HTMLElement;
  marqueeRect(): HTMLElement | null;
  /** the world position read back from an object's inline left/top */
  pos(el: HTMLElement): { x: number; y: number };
  /** the rendered size read back from an object's inline width/height */
  size(el: HTMLElement): { width: number; height: number };
  /** world -> screen through the live camera (screen = (world - cam) * zoom) */
  toScreen(p: { x: number; y: number }): { x: number; y: number };
  /** screen -> world at the live camera */
  toWorld(p: { x: number; y: number }): { x: number; y: number };
  /** the marquee rect's world box, from its data attributes */
  marqueeBox(): { x: number; y: number; width: number; height: number } | null;
  snapshot(): readonly ObjectSnapshot[];
  press(el: HTMLElement | null, x: number, y: number, opts?: PointerOpts): void;
  /** pointermove on window (what the transform gesture listens to) */
  move(x: number, y: number, opts?: PointerOpts): void;
  /** pointermove on a specific element (what the viewport's own handlers see) */
  moveOn(el: HTMLElement, x: number, y: number, opts?: PointerOpts): void;
  /**
   * Let the browser paint: the camera commits its coalesced writes on an
   * animation frame, so a test that reads the camera after a drag has to wait
   * for one. Awaiting real frames (not fake timers) keeps React's own writes
   * and the camera's rAF on the same clock.
   */
  frames(n?: number): Promise<void>;
  release(el: HTMLElement | null, x: number, y: number, opts?: PointerOpts): void;
  /** press, move in `steps` hops, release; every frame is flushed */
  drag(el: HTMLElement | null, from: { x: number; y: number }, to: { x: number; y: number }, opts?: PointerOpts): void;
  /** drag on empty board space (the viewport itself): pan or marquee with Shift */
  dragEmpty(from: { x: number; y: number }, to: { x: number; y: number }, opts?: PointerOpts): void;
  /** press on empty space, move, then pointercancel */
  cancelDragEmpty(from: { x: number; y: number }, to: { x: number; y: number }, opts?: PointerOpts): void;
  /** Escape on the open text editor, the way the note's own editor consumes it */
  escapeEditor(): void;
  key(key: string, opts?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; target?: Element | null }): void;
  idsOfNotes(): string[];
  idsOfBoxes(): string[];
}

interface PointerOpts {
  shiftKey?: boolean;
  pointerId?: number;
  button?: number;
  /** how many intermediate pointermove events a drag emits (default 3) */
  steps?: number;
}

function pointerOptions(o: PointerOpts, x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    button: o.button ?? 0,
    pointerId: o.pointerId ?? 1,
    shiftKey: o.shiftKey === true,
    bubbles: true,
    cancelable: true,
  };
}

/** Render the board with a provider the test owns (and the doc behind it). */
export function renderBoard7(): Board7Harness {
  let doc: Y.Doc | null = null;
  let provider: NullProvider | null = null;
  const view = render(
    <BoardApp
      boardId={TEST_BOARD_ID}
      makeProvider={(_url: string, _room: string, d: Y.Doc) => {
        doc = d;
        provider = new NullProvider();
        return provider;
      }}
    />,
  );

  const theDoc = () => {
    if (!doc) throw new Error('the board never built its doc');
    return doc;
  };
  const theProvider = () => {
    if (!provider) throw new Error('the board never built a provider');
    return provider;
  };

  // Anything in the object layer that marks itself with an object id: the objects
  // themselves, never the overlay's decoration, which lives outside the world layer.
  const objects = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-object-id]')).filter(
      (el) => !el.classList.contains('selection-outline'),
    );

  const h: Board7Harness = {
    view,
    doc: theDoc,
    provider: theProvider,
    viewport: () => screen.getByTestId('viewport'),
    worldLayer: () => screen.getByTestId('world-layer'),
    cam() {
      const el = screen.getByTestId('world-layer');
      return {
        x: Number(el.getAttribute('data-cam-x')),
        y: Number(el.getAttribute('data-cam-y')),
        zoom: Number(el.getAttribute('data-cam-zoom')),
      };
    },
    notes: () => screen.queryAllByRole('group', { name: 'Sticky note' }),
    note: (i: number) => screen.queryAllByRole('group', { name: 'Sticky note' })[i] as HTMLElement,
    boxes: () => screen.queryAllByRole('group', { name: 'Test box' }),
    box: (i: number) => screen.queryAllByRole('group', { name: 'Test box' })[i] as HTMLElement,
    // The object's own element, found by the id every object component carries.
    // The overlay's outlines repeat the id, so they are excluded by class.
    object: (id: string) =>
      document.querySelector<HTMLElement>(
        `[data-testid="sticky-${id}"], [data-testid="testbox-${id}"], [data-object-id="${id}"]:not(.selection-outline)`,
      ),
    selected: () => objects().filter((el) => el.getAttribute('data-selected') === 'true'),
    selectedIds() {
      const ids: string[] = [];
      for (const el of h.selected()) {
        const id = el.getAttribute('data-object-id');
        if (id) ids.push(id);
      }
      return ids.sort();
    },
    outline: (id: string) =>
      document.querySelector<HTMLElement>(`.selection-outline[data-object-id="${id}"]`),
    selectionCount: () => screen.queryByTestId('selection-count')?.textContent ?? null,
    barDeleteButton: () => screen.queryByRole('button', { name: 'Delete selection' }),
    noteToolbar: () => screen.queryByTestId('note-toolbar'),
    handles: () => Array.from(document.querySelectorAll<HTMLElement>('[data-handle]')),
    handle: (name: string) => {
      const el = document.querySelector<HTMLElement>(`[data-handle="${name}"]`);
      if (!el) throw new Error(`no handle ${name}`);
      return el;
    },
    marqueeRect: () => screen.queryByTestId('marquee'),
    toScreen(p) {
      const c = h.cam();
      return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
    },
    toWorld(p) {
      const c = h.cam();
      return { x: p.x / c.zoom + c.x, y: p.y / c.zoom + c.y };
    },
    pos(el: HTMLElement) {
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    },
    size(el: HTMLElement) {
      return { width: parseFloat(el.style.width), height: parseFloat(el.style.height) };
    },
    marqueeBox() {
      const el = screen.queryByTestId('marquee');
      if (!el) return null;
      return {
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      };
    },
    snapshot: () => snapshotOf(theDoc()),
    press(el, x, y, o = {}) {
      if (!el) throw new Error('press: no element');
      fireEvent.pointerDown(el, pointerOptions(o, x, y));
    },
    move(x, y, o = {}) {
      fireEvent.pointerMove(window, pointerOptions(o, x, y));
    },
    moveOn(el, x, y, o = {}) {
      fireEvent.pointerMove(el, pointerOptions(o, x, y));
    },
    async frames(n = 2) {
      for (let i = 0; i < n; i++) {
        await act(async () => {
          await new Promise<void>((res) => {
            requestAnimationFrame(() => res());
          });
        });
      }
    },
    release(el, x, y, o = {}) {
      fireEvent.pointerUp(el ?? window, pointerOptions(o, x, y));
    },
    drag(el, from, to, o = {}) {
      if (!el) throw new Error('drag: no element');
      fireEvent.pointerDown(el, pointerOptions(o, from.x, from.y));
      const steps = o.steps ?? 3;
      for (let i = 1; i <= steps; i++) {
        fireEvent.pointerMove(window, {
          ...pointerOptions(o, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps),
        });
      }
      fireEvent.pointerUp(el, pointerOptions(o, to.x, to.y));
    },
    dragEmpty(from, to, o = {}) {
      const vp = screen.getByTestId('viewport');
      fireEvent.pointerDown(vp, pointerOptions(o, from.x, from.y));
      const steps = o.steps ?? 3;
      for (let i = 1; i <= steps; i++) {
        fireEvent.pointerMove(vp, {
          ...pointerOptions(o, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps),
        });
      }
      fireEvent.pointerUp(vp, pointerOptions(o, to.x, to.y));
    },
    cancelDragEmpty(from, to, o = {}) {
      const vp = screen.getByTestId('viewport');
      fireEvent.pointerDown(vp, pointerOptions(o, from.x, from.y));
      fireEvent.pointerMove(vp, pointerOptions(o, to.x, to.y));
      fireEvent.pointerCancel(vp, { pointerId: o.pointerId ?? 1, bubbles: true, cancelable: true });
    },
    escapeEditor() {
      const ed = screen.queryByTestId('sticky-editor');
      if (!ed) throw new Error('no editor is open');
      fireEvent.keyDown(ed, { key: 'Escape', bubbles: true, cancelable: true });
    },
    key(key, o = {}) {
      const target = o.target ?? window;
      fireEvent.keyDown(target as Element | Document, {
        key,
        shiftKey: o.shiftKey === true,
        ctrlKey: o.ctrlKey === true,
        metaKey: o.metaKey === true,
        bubbles: true,
        cancelable: true,
      });
    },
    idsOfNotes: () => h.notes().map((el) => el.getAttribute('data-object-id') ?? ''),
    idsOfBoxes: () => h.boxes().map((el) => el.getAttribute('data-object-id') ?? ''),
  };
  return h;
}

// Seeding writes the model, then lets React see it in one act() turn.
export function seedSticky(doc: Y.Doc, seed: Seed): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: seed.x + (seed.width ?? STICKY_SIZE_WORLD) / 2, y: seed.y + (seed.height ?? STICKY_SIZE_WORLD) / 2 }, seed.color ?? 'yellow');
    const m = objectsMapOf(doc).get(id);
    if (!m) throw new Error('seed: sticky vanished');
    if (seed.text !== undefined) (m.get('text') as Y.Text).insert(0, seed.text);
    if (seed.z !== undefined) m.set('z', seed.z);
    if (seed.width !== undefined || seed.height !== undefined) {
      resizeObjects(doc, new Map([[id, rectAt(seed.x, seed.y, seed.width ?? STICKY_SIZE_WORLD, seed.height ?? STICKY_SIZE_WORLD)]]));
    }
  });
  return id;
}

/** A testbox: the test-only type, resizable and NOT aspect-locked. */
export function seedBox(doc: Y.Doc, seed: Seed): string {
  let id = '';
  act(() => {
    id = `box-${Math.random().toString(36).slice(2, 10)}`;
    const m = new Y.Map<unknown>();
    m.set('type', 'testbox');
    m.set('x', seed.x);
    m.set('y', seed.y);
    m.set('width', seed.width ?? 100);
    m.set('height', seed.height ?? 100);
    m.set('z', seed.z ?? 1);
    m.set('createdAt', 0);
    objectsMapOf(doc).set(id, m);
  });
  return id;
}

function rectAt(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

function snapshotOf(doc: Y.Doc): readonly ObjectSnapshot[] {
  return objectsSnapshot(doc);
}

/** Wait for React to settle after writes that happened outside act(). */
export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export { act, fireEvent, screen };
