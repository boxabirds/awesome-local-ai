import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import App from '../../src/client/App';
import { createBoardDoc } from '../../src/client/board/useBoardDoc';
import { LOCAL_ORIGIN, createSticky, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { TEST_VIEWPORT, pointerCoordinates, readWorldTransform } from './harness';

/**
 * Story 2 component harness: renders the real `App` (viewport, world layer,
 * toolbars, notes) with an injected `Y.Doc` and a fixed 1200x800 board area, so
 * tests can drive pointer and keyboard events against the real component tree.
 */

/**
 * Drain the frames a note drag schedules (one per pointer move) *inside* `act`,
 * so the document writes those frames make cannot leave React work queued into
 * the next test.
 */
export async function flushFrames(frames = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < frames; index += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

export { pointerCoordinates, TEST_VIEWPORT };

export interface PointerPoint {
  x: number;
  y: number;
}

export interface AppHarnessResult {
  view: RenderResult;
  doc: Y.Doc;
  /** Number of document updates this client wrote (remote writes are excluded). */
  localUpdates(): number;
  resetLocalUpdates(): void;
  flushFrames(): Promise<void>;
  viewport(): HTMLElement;
  world(): HTMLElement;
  notes(): HTMLElement[];
  note(indexOrId?: number | string): HTMLElement;
  noteId(el: HTMLElement): string;
  noteText(el: HTMLElement): HTMLElement;
  measure(el: HTMLElement): HTMLElement;
  textarea(el?: HTMLElement): HTMLTextAreaElement | null;
  noteToolbar(el?: HTMLElement): HTMLElement | null;
  stickyButton(): HTMLButtonElement;
  snapshots(): readonly StickySnapshot[];
  byId(id: string): StickySnapshot | undefined;
  camera(): { zoom: number; x: number; y: number };
}

export async function renderApp(doc: Y.Doc = createBoardDoc()): Promise<AppHarnessResult> {
  const view = render(<App doc={doc} viewportSize={TEST_VIEWPORT} />);
  // Let React commit before the test touches the DOM: mutations from a previous
  // test can leave React's act queue with work still queued.
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  let updates = 0;
  const countLocal = (_update: Uint8Array, origin: unknown): void => {
    if (origin === LOCAL_ORIGIN) {
      updates += 1;
    }
  };
  doc.on('update', countLocal);

  const testId = (id: string): HTMLElement => view.getByTestId(id);
  const notes = (): HTMLElement[] => Array.from(view.queryAllByTestId('sticky-note'));

  const note = (indexOrId?: number | string): HTMLElement => {
    const all = notes();
    if (indexOrId === undefined) {
      if (all.length !== 1) {
        throw new Error(`expected exactly one note, found ${all.length}`);
      }
      return all[0] as HTMLElement;
    }
    if (typeof indexOrId === 'number') {
      const el = all[indexOrId];
      if (!el) {
        throw new Error(`no note at index ${indexOrId}`);
      }
      return el as HTMLElement;
    }
    const el = all.find((candidate) => candidate.getAttribute('data-note-id') === indexOrId);
    if (!el) {
      throw new Error(`no note with id ${indexOrId}`);
    }
    return el;
  };

  return {
    view,
    doc,
    localUpdates: () => updates,
    resetLocalUpdates: () => {
      updates = 0;
    },
    flushFrames,
    viewport: () => testId('board-viewport'),
    world: () => testId('board-world'),
    notes,
    note,
    noteId: (el) => el.getAttribute('data-note-id') ?? '',
    noteText: (el) => el.querySelector<HTMLElement>('[data-testid="sticky-text"]') as HTMLElement,
    measure: (el) => el.querySelector<HTMLElement>('[data-testid="sticky-measure"]') as HTMLElement,
    textarea: (el) =>
      (el ?? view.container).querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]'),
    noteToolbar: (el) => (el ?? view.container).querySelector<HTMLElement>('[data-testid="note-toolbar"]'),
    stickyButton: () => view.getByTestId('create-sticky') as HTMLButtonElement,
    snapshots: () => snapshot(doc),
    byId: (id) => snapshot(doc).find((entry) => entry.id === id),
    camera: () => readWorldTransform(testId('board-world')),
  };
}

/** Write to the document the way another client would: outside React. */
/**
 * Write to the document the way another client would: outside React, then let
 * React commit the change before the test queries the DOM.
 */
export async function mutate<T>(fn: () => T): Promise<T> {
  let result: T | undefined;
  await act(async () => {
    result = fn();
  });
  return result as T;
}

/** Add a note straight through the model, as the app would. */
export async function addNote(doc: Y.Doc, x: number, y: number): Promise<string> {
  const id = await mutate(() => createSticky(doc, { x, y }));
  if (id === null) {
    throw new Error('fixture note was rejected');
  }
  return id;
}

/**
 * Every interaction is awaited so React commits the state the event caused
 * before the test reads the DOM. `fireEvent` alone can leave work queued when a
 * previous test ended with an unwrapped document write.
 */
async function step(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
}

export function press(el: HTMLElement, at: PointerPoint): Promise<void> {
  return step(() => {
    fireEvent.pointerDown(el, { ...pointerCoordinates(at.x, at.y) });
  });
}

export function moveTo(el: HTMLElement, at: PointerPoint): Promise<void> {
  return step(() => {
    fireEvent.pointerMove(el, { ...pointerCoordinates(at.x, at.y) });
  });
}

export function release(el: HTMLElement, at: PointerPoint): Promise<void> {
  return step(() => {
    fireEvent.pointerUp(el, { ...pointerCoordinates(at.x, at.y) });
  });
}

export function cancel(el: HTMLElement, at: PointerPoint): Promise<void> {
  return step(() => {
    fireEvent.pointerCancel(el, { ...pointerCoordinates(at.x, at.y) });
  });
}

export function click(el: HTMLElement): Promise<void> {
  return step(() => {
    fireEvent.click(el);
  });
}

export function doubleClick(el: HTMLElement, at: PointerPoint = { x: 0, y: 0 }): Promise<void> {
  return step(() => {
    fireEvent.doubleClick(el, { clientX: at.x, clientY: at.y, button: 0 });
  });
}

export function typeText(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  return step(() => {
    fireEvent.change(textarea, { target: { value } });
  });
}

export function key(target: Window | Document | Element, keyName: string): Promise<void> {
  return step(() => {
    fireEvent.keyDown(target, { key: keyName, code: keyName });
  });
}

export { fireEvent, act };
