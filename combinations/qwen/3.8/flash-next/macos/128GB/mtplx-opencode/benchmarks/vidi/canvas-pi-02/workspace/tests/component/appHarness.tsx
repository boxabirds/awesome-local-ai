import { act, render } from '@testing-library/react';
import { Profiler, StrictMode, createElement } from 'react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { BoardDocProvider, createBoardDoc, type BoardDoc } from '../../src/client/board/useBoardDoc';
import type { Camera } from '../../src/client/canvas/camera';
import { dispatch } from './harness';
import {
  createSticky,
  getStickyText,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';

/**
 * Harness for the story 2 components: the real App, a real Y.Doc, and the real
 * board-model functions to seed it. Nothing is mocked - when a test says "the
 * note moved", it means the Y.Doc says so.
 */

export interface SeedNote {
  /** Top-left corner of the note, world units. */
  x: number;
  y: number;
  color?: StickyColor;
  text?: string;
}

export interface AppHarnessOptions {
  /** Render inside StrictMode (default). */
  strict?: boolean;
  /** Records the duration of every React commit, for render-cost tests. */
  profile?: (actualDuration: number) => void;
}

export interface AppHarness {
  doc: Y.Doc;
  container: HTMLElement;
  board(): HTMLElement;
  world(): HTMLElement;
  camera(): Camera;
  notes(): readonly StickySnapshot[];
  noteElements(): HTMLElement[];
  noteElement(id: string): HTMLElement;
  noteText(id: string): string;
  editor(): HTMLTextAreaElement | null;
  toolbar(): HTMLElement | null;
  counter(): HTMLElement | null;
  button(name: string): HTMLButtonElement;
}

function parseCamera(value: string | null): Camera {
  const [x, y, zoom] = (value ?? '').split(',').map(Number);
  return { x, y, zoom };
}

/** `seed` is applied to the document before the first render, like a loaded board. */
export function renderApp(
  seed: SeedNote[] = [],
  options: AppHarnessOptions = {},
): AppHarness {
  const doc = new Y.Doc();
  const board: BoardDoc = createBoardDoc(doc);

  for (const note of seed) {
    // The harness speaks in corners, the model in centres.
    const id = createSticky(doc, { x: note.x + 100, y: note.y + 100 });
    if (!id) throw new Error('seeding a note failed');
    if (note.color) setStickyColor(doc, id, note.color);
    if (note.text) getStickyText(doc, id)?.insert(0, note.text);
  }

  const app = createElement(App, null);
  const tree = options.profile
    ? createElement(
        Profiler,
        {
          id: 'app',
          onRender: (_id, _phase, actualDuration) => options.profile?.(actualDuration),
        },
        app,
      )
    : app;

  const rendered = render(
    createElement(
      BoardDocProvider,
      { value: board },
      options.strict === false ? tree : createElement(StrictMode, null, tree),
    ),
  );

  const container = rendered.container;

  const board$ = (): HTMLElement => {
    const el = container.querySelector<HTMLElement>('[data-testid="board-viewport"]');
    if (!el) throw new Error('the board viewport is not mounted');
    return el;
  };

  const harness: AppHarness = {
    doc,
    container,
    board: board$,
    world: () => {
      const el = container.querySelector<HTMLElement>('[data-testid="world-layer"]');
      if (!el) throw new Error('the world layer is not mounted');
      return el;
    },
    camera: () => parseCamera(board$().dataset.camera ?? null),
    notes: () => snapshot(doc),
    noteElements: () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')),
    noteElement: (id: string) => {
      const el = container.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
      if (!el) throw new Error(`note ${id} is not rendered`);
      return el;
    },
    noteText: (id: string) =>
      harness
        .noteElement(id)
        .querySelector<HTMLElement>('[data-testid="sticky-note-text"]')?.textContent ?? '',
    editor: () =>
      container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-note-editor"]'),
    toolbar: () => container.querySelector<HTMLElement>('[data-testid="note-toolbar"]'),
    counter: () => container.querySelector<HTMLElement>('[data-testid="sticky-note-counter"]'),
    button: (name: string) => {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
      const found = buttons.find((button) => button.getAttribute('aria-label') === name);
      if (!found) throw new Error(`no button named "${name}"`);
      return found;
    },
  };

  return harness;
}

/** Add a note to a mounted board (what `window.__vidi6.seedNote` does in e2e). */
export function seedNote(harness: AppHarness, note: SeedNote): string {
  const id = createSticky(harness.doc, { x: note.x + 100, y: note.y + 100 });
  if (!id) return '';
  if (note.color) setStickyColor(harness.doc, id, note.color);
  if (note.text) getStickyText(harness.doc, id)?.insert(0, note.text);
  return id;
}

/** Let a document change reach React, and React reach the DOM. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });
}

/**
 * Type a whole string into the note's textarea.
 *
 * jsdom performs no text editing, so a key alone changes nothing. The value is
 * written through the *prototype* setter, which is what a real edit does: React
 * keeps a value tracker on the element that swallows an `input` event when the
 * value was assigned through the instance property, and a real browser never
 * goes through that property.
 */
export async function typeText(target: HTMLTextAreaElement, next: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(target, next);
  else target.value = next;
  await dispatch(target, new Event('input', { bubbles: true, cancelable: true }));
}
