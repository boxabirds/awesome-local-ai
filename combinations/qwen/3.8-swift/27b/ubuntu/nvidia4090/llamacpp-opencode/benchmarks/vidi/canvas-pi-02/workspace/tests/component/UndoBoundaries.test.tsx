// Story 8 (undo.boundaries) component tests: TC-14 to TC-17.
// Real app wiring (renderAppAt): useTransformGesture, StickyTextEditor and
// the personal UndoController created by BoardPage. The y-websocket
// provider is faked (as in the story 7 tests) so the board reaches
// connected + synced deterministically.

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';

interface FakeProvider {
  doc: Y.Doc;
  open(): void;
  doSync(): void;
  close(code: number): void;
}

vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    static instances: FakeProvider[] = [];
    doc: Y.Doc;
    private listeners: Record<string, Array<(arg: unknown) => void>> = {};
    constructor(_url: string, _room: string, doc: Y.Doc, _opts: unknown) {
      this.doc = doc;
      FakeWebsocketProvider.instances.push(this);
    }
    on(ev: string, fn: (arg: unknown) => void): void {
      (this.listeners[ev] ??= []).push(fn);
    }
    off(ev: string, fn: (arg: unknown) => void): void {
      this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== fn);
    }
    destroy(): void {
      this.listeners = {};
    }
    private emit(ev: string, arg: unknown): void {
      (this.listeners[ev] ?? []).slice().forEach((f) => f(arg));
    }
    open(): void {
      this.emit('status', { status: 'connected' });
    }
    doSync(): void {
      this.emit('sync', true);
    }
    close(code: number): void {
      this.emit('connection-close', { code, reason: 'test' });
      this.emit('status', { status: 'disconnected' });
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, ...extra });
  return e;
}

/** Dispatch a synthetic event and let React flush the resulting work. */
function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

/** Flush rAF-batched gesture writes (fake timers). */
function flush(): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(16);
  });
}

function key(type: string, props: Record<string, unknown> = {}): Event {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
  return e;
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

async function setupApp(): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  expect(screen.queryByTestId('connection-status')).toBeNull();
  return provider.doc;
}

interface Note {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

const notes = (): Note[] => window.__vidi6?.getStickyNotes() ?? [];
const note = (id: string): Note => {
  const n = notes().find((s) => s.id === id);
  if (n === undefined) throw new Error(`note ${id} missing`);
  return n;
};

const selected = (): string[] => window.__vidi6?.getSelectedIds() ?? [];
const selectAll = (): void => {
  windowKey(key('keydown', { key: 'a', ctrlKey: true }));
};

const noteEl = (id: string): HTMLElement =>
  document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`) as HTMLElement;

/** Creates a note centred on world (x, y) through the test hook. */
async function createNote(x: number, y: number): Promise<string> {
  const id = window.__vidi6?.createSticky(x, y);
  expect(id).not.toBeNull();
  await act(async () => {});
  return id as string;
}

/** Ctrl+Z on the window (the board-level shortcut). */
function undoKey(): boolean {
  return windowKey(key('keydown', { key: 'z', ctrlKey: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.boundaries: gestures and typing (TC-14 to TC-17)', () => {
  it('TC-14: a 30-frame drag of a 2-note selection is ONE undo step restoring both notes', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    const b = await createNote(300, 0);
    selectAll();
    expect(selected().sort()).toEqual([a, b].sort());
    const xA0 = note(a).x;
    const xB0 = note(b).x;

    // 30 rAF frames of dragging note a (the selection moves together).
    fire(noteEl(a), pointerEvent('pointerdown', 512, 384));
    for (let i = 1; i <= 30; i++) {
      fire(window, pointerEvent('pointermove', 512 + 3 * i, 384 + 2 * i));
      await flush();
    }
    fire(window, pointerEvent('pointerup', 512 + 3 * 30, 384 + 2 * 30));
    await flush();

    // The whole drag moved both notes...
    expect(note(a).x).toBe(xA0 + 90);
    expect(note(b).x).toBe(xB0 + 90);

    // ...and ONE Ctrl+Z restores the start positions of both.
    expect(undoKey()).toBe(true);
    expect(note(a).x).toBe(xA0);
    expect(note(b).x).toBe(xB0);
  });

  it('TC-15: a move and a colour change 200 ms apart are two separate steps', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    selectAll();
    const xA0 = note(a).x;

    // Move the note +100.
    fire(noteEl(a), pointerEvent('pointerdown', 512, 384));
    fire(window, pointerEvent('pointermove', 612, 384));
    await flush();
    fire(window, pointerEvent('pointerup', 612, 384));
    await flush();
    expect(note(a).x).toBe(xA0 + 100);

    // 200 ms later: change the colour (gesture end already closed the
    // capture window; the colour change is its own step).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));
    expect(note(a).color).toBe('blue');

    // First undo reverses the COLOUR only (the move is the older step).
    expect(undoKey()).toBe(true);
    expect(note(a).color).toBe('yellow');
    expect(note(a).x).toBe(xA0 + 100);

    // Second undo reverses the move.
    expect(undoKey()).toBe(true);
    expect(note(a).x).toBe(xA0);
  });

  it('TC-16: Ctrl+Z inside the editor undoes typing; the earlier move survives', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    selectAll();
    const xA0 = note(a).x;

    // Move the note +100 (one step).
    fire(noteEl(a), pointerEvent('pointerdown', 512, 384));
    fire(window, pointerEvent('pointermove', 612, 384));
    await flush();
    fire(window, pointerEvent('pointerup', 612, 384));
    await flush();
    expect(note(a).x).toBe(xA0 + 100);

    // Start editing and type (one typing step, separated by the mount
    // boundary).
    fireEvent.doubleClick(noteEl(a));
    const textarea = screen.getByTestId('sticky-editor-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(note(a).text).toBe('hello');

    // Ctrl+Z inside the editor undoes the typing only: the note keeps its
    // moved position.
    fire(textarea, key('keydown', { key: 'z', ctrlKey: true }));
    expect(note(a).text).toBe('');
    expect(note(a).x).toBe(xA0 + 100);

    // Leave editing; the board-level Ctrl+Z now undoes the move.
    fire(textarea, key('keydown', { key: 'Escape' }));
    expect(undoKey()).toBe(true);
    expect(note(a).x).toBe(xA0);
  });

  it('TC-17: pointercancel mid-drag → the partial drag is ONE step restoring the start', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    selectAll();
    const xA0 = note(a).x;

    fire(noteEl(a), pointerEvent('pointerdown', 512, 384));
    fire(window, pointerEvent('pointermove', 540, 384));
    await flush();
    fire(window, pointerEvent('pointermove', 570, 390));
    await flush();
    fire(window, pointerEvent('pointercancel', 570, 390));
    await flush();

    // The partial drag moved the note...
    expect(note(a).x).toBe(xA0 + 58);

    // ...and ONE Ctrl+Z restores the start position.
    expect(undoKey()).toBe(true);
    expect(note(a).x).toBe(xA0);
  });
});
