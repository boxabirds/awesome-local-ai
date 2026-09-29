// Story 7 (sel.*) component tests: TC-16 to TC-31.
//
// The y-websocket provider is replaced with a fake (as in the story 4
// load-failure tests) so TC-25 can drive the load-failed (locked) state and
// every test can deterministically reach `connected + synced` (editable).

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { createTestbox, registerTestbox } from '../fixtures/testbox';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';

/** Fake provider: records the doc it was given and lets tests emit the
 *  provider events the tracker listens for. */
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

/** Renders the app and drives the fake provider to connected + synced. */
async function setupApp(): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  expect(screen.queryByTestId('connection-status')).toBeNull(); // connected
  return provider.doc;
}

interface Note {
  id: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  color: string;
  text: string;
  z: number;
}

const notes = (): Note[] => window.__vidi6?.getStickyNotes() ?? [];
const selected = (): string[] => window.__vidi6?.getSelectedIds() ?? [];

/** Creates a note at world (x, y) through the test hook; flushes the
 *  resulting re-render (selection pruning/present-id tracking) first. */
async function createNote(x: number, y: number): Promise<string> {
  const id = window.__vidi6?.createSticky(x, y);
  expect(id).not.toBeNull();
  await act(async () => {});
  return id as string;
}

const noteEl = (id: string): HTMLElement =>
  document.querySelector(`[data-testid="sticky-note"][data-id="${id}"]`) as HTMLElement;

/** Deselects then selects exactly `ids` via Shift-free click on the first,
 *  Shift+clicks for the rest — or simply uses select-all for a full set. */
function selectAll(): void {
  windowKey(key('keydown', { key: 'a', ctrlKey: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TC-16/17/18: selection bar and pruning', () => {
  it('TC-16: all selected objects deleted remotely → selection Empty, bar hidden', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    const b = await createNote(300, 0);
    selectAll();
    expect(selected().sort()).toEqual([a, b].sort());
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    // Both notes vanish (remote delete) in one batch.
    act(() => {
      window.__vidi6?.deleteSticky(a);
      window.__vidi6?.deleteSticky(b);
    });

    expect(selected()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-17: two selected → "2 selected" + Delete, with aria-live announcement', async () => {
    await setupApp();
    await createNote(0, 0);
    await createNote(300, 0);
    selectAll();

    const bar = screen.getByTestId('selection-bar');
    const count = screen.getByText('2 selected');
    expect(count.closest('[aria-live]')).not.toBeNull();
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Delete selection' }));
  });

  it('TC-18: one selected sticky → the NoteToolbar, not the group bar', async () => {
    await setupApp();
    await createNote(0, 0);
    selectAll();

    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('TC-19: empty-space click clears', () => {
  it('TC-19: press+release on empty space (no drag) → Empty', async () => {
    await setupApp();
    await createNote(0, 0);
    await createNote(300, 0);
    selectAll();
    expect(selected()).toHaveLength(2);

    const viewport = screen.getByTestId('board-viewport');
    fire(viewport, pointerEvent('pointerdown', 600, 600));
    fire(viewport, pointerEvent('pointerup', 600, 600));

    expect(selected()).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });
});

describe('TC-20/21/22: marquee', () => {
  it('TC-20: Shift+drag adds fully-inside ids to the existing selection', async () => {
    await setupApp();
    // createSticky centres the note on the point: (400,400) puts a 200×200
    // note at (300..500)², fully inside the (300..560)² marquee rect.
    const a = await createNote(0, 0); // (-100..100)²: outside the marquee rect
    selectAll(); // {a}
    const b = await createNote(400, 400); // (300..500)²: fully inside
    const c = await createNote(450, 600); // (350..550)×(500..700): half inside
    expect(selected()).toEqual([a]);
    expect(selected()).not.toContain(c);

    const viewport = screen.getByTestId('board-viewport');
    fire(viewport, pointerEvent('pointerdown', 300, 300, { shiftKey: true }));
    expect(viewport).toHaveAttribute('data-marquee-state', 'active');
    expect(screen.getByTestId('marquee-rect')).toBeTruthy();
    // The viewport captured the pointer; later events arrive at the viewport.
    fire(viewport, pointerEvent('pointermove', 560, 560, { shiftKey: true }));
    fire(viewport, pointerEvent('pointerup', 560, 560, { shiftKey: true }));

    expect(selected().sort()).toEqual([a, b].sort()); // c is only half inside
  });

  it('TC-21 (negative): plain drag on empty space pans; no marquee, no selection', async () => {
    await setupApp();
    const a = await createNote(400, 400);
    const xA0 = notes().find((n) => n.id === a)!.x;
    expect(selected()).toHaveLength(0);

    const viewport = screen.getByTestId('board-viewport');
    fire(viewport, pointerEvent('pointerdown', 100, 100));
    expect(viewport).toHaveAttribute('data-marquee-state', 'idle');
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    fire(viewport, pointerEvent('pointermove', 150, 150));
    fire(viewport, pointerEvent('pointerup', 150, 150));
    await flush();

    // Panned by (50, 50); nothing selected; the note did not move.
    expect(window.__vidi6?.getCamera()).toEqual({ x: -50, y: -50, zoom: 1 });
    expect(selected()).toHaveLength(0);
    expect(notes().find((n) => n.id === a)?.x).toBe(xA0);
  });

  it('TC-22: pointercancel mid-marquee → selection unchanged', async () => {
    await setupApp();
    const b = await createNote(400, 400); // (300..500)²: fully inside
    expect(selected()).toHaveLength(0);
    expect(selected()).not.toContain(b);

    const viewport = screen.getByTestId('board-viewport');
    fire(viewport, pointerEvent('pointerdown', 300, 300, { shiftKey: true }));
    fire(viewport, pointerEvent('pointermove', 560, 560, { shiftKey: true }));
    fire(viewport, pointerEvent('pointercancel', 560, 560));

    expect(selected()).toHaveLength(0); // b was fully inside, but the marquee was cancelled
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });
});

describe('TC-23/26: transform gesture', () => {
  it('TC-23: dragging an unselected object selects just it and moves only it', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    selectAll(); // {a}
    const b = await createNote(0, -150); // above a, inside the (jsdom) viewport cull
    expect(selected()).toEqual([a]);

    const elB = noteEl(b);
    const xB0 = notes().find((n) => n.id === b)!.x;
    const xA0 = notes().find((n) => n.id === a)!.x;

    fire(elB, pointerEvent('pointerdown', 0, -150));
    fire(window, pointerEvent('pointermove', 30, -150));
    await flush();
    fire(window, pointerEvent('pointerup', 30, -150));

    expect(selected()).toEqual([b]); // selection followed the dragged note
    expect(notes().find((n) => n.id === b)?.x).toBe(xB0 + 30);
    expect(notes().find((n) => n.id === a)?.x).toBe(xA0); // a untouched
  });

  it('TC-26: one drag → onGestureStart and onGestureEnd exactly once each', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    selectAll();

    const el = noteEl(a);
    fire(el, pointerEvent('pointerdown', 10, 10));
    fire(window, pointerEvent('pointermove', 40, 10));
    await flush();
    fire(window, pointerEvent('pointerup', 40, 10));

    expect(window.__vidi6?.getGestureEvents()).toEqual({ start: 1, end: 1 });

    // A press under the threshold is not a gesture.
    fire(el, pointerEvent('pointerdown', 10, 10));
    fire(window, pointerEvent('pointerup', 11, 10));
    expect(window.__vidi6?.getGestureEvents()).toEqual({ start: 1, end: 1 });
  });
});

describe('TC-24: non-aspect-locked type resizes per axis (Shift locks)', () => {
  it('TC-24: testbox "e" handle changes width only; with Shift the ratio holds', async () => {
    registerTestbox();
    const doc = await setupApp();
    const id = createTestbox(doc, 100, 100, 100, 50);
    await act(async () => {});
    selectAll();

    const handle = screen.getByRole('button', { name: 'Resize right' });

    // Plain drag: width +50, height unchanged.
    fire(handle, pointerEvent('pointerdown', 200, 125));
    fire(window, pointerEvent('pointermove', 250, 125));
    await flush();
    fire(window, pointerEvent('pointerup', 250, 125));

    let entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
    expect(entry.get('width')).toBe(150);
    expect(entry.get('height')).toBe(50);

    // Shift drag: the bounding box keeps its ratio (150:50 = 3:1).
    fire(handle, pointerEvent('pointerdown', 250, 125, { shiftKey: true }));
    fire(window, pointerEvent('pointermove', 300, 125, { shiftKey: true }));
    await flush();
    fire(window, pointerEvent('pointerup', 300, 125, { shiftKey: true }));

    entry = doc.getMap('objects').get(id) as Y.Map<unknown>;
    const w = entry.get('width') as number;
    const h = entry.get('height') as number;
    // Width grew 150 → 200 (scale 4/3), so height 50 → 66.66…; ratio 3:1.
    expect(w).toBeCloseTo(200, 6);
    expect(h).toBeCloseTo((50 * 4) / 3, 6);
    expect(w / h).toBeCloseTo(3, 5);
  });
});

describe('TC-25: locked board refuses gestures (negative)', () => {
  it('TC-25: load-failed board: selection works, drag makes no writes', async () => {
    await renderAppAt();
    const all = fakeProviders();
    const provider = all[all.length - 1];
    act(() => provider.open());
    act(() => provider.doSync());
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));

    const id = await createNote(0, 0);
    selectAll();
    expect(selected()).toEqual([id]); // selection is allowed on a locked board
    const x0 = notes().find((n) => n.id === id)!.x;

    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 10, 10));
    fire(window, pointerEvent('pointermove', 60, 10));
    await flush();
    fire(window, pointerEvent('pointerup', 60, 10));

    // No gesture started → no writes, note exactly where it was created.
    expect(notes().find((n) => n.id === id)?.x).toBe(x0);
    expect(window.__vidi6?.getGestureEvents()).toEqual({ start: 0, end: 0 });
  });
});

describe('TC-27/28/29/30/31: keyboard', () => {
  it('TC-27: Ctrl+A selects all; preventDefault; no page text selected', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    const b = await createNote(300, 0);
    const c = await createNote(600, 0);

    const e = key('keydown', { key: 'a', ctrlKey: true });
    const prevented = windowKey(e);
    expect(prevented).toBe(true);
    expect(selected().sort()).toEqual([a, b, c].sort());
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('TC-28: Ctrl+A on an empty board → stays Empty, no error', async () => {
    await setupApp();
    expect(() => windowKey(key('keydown', { key: 'a', ctrlKey: true }))).not.toThrow();
    expect(selected()).toHaveLength(0);
  });

  it('TC-29: ArrowRight x+1 for all selected; Shift+ArrowUp y−10; preventDefault', async () => {
    await setupApp();
    const a = await createNote(0, 0);
    const b = await createNote(0, 0);
    selectAll();
    const a0 = notes().find((n) => n.id === a)!;
    const b0 = notes().find((n) => n.id === b)!;

    const e1 = key('keydown', { key: 'ArrowRight' });
    expect(windowKey(e1)).toBe(true);
    expect(notes().find((n) => n.id === a)?.x).toBe(a0.x + NUDGE_STEP_WORLD);
    expect(notes().find((n) => n.id === b)?.x).toBe(b0.x + NUDGE_STEP_WORLD);

    const e2 = key('keydown', { key: 'ArrowUp', shiftKey: true });
    expect(windowKey(e2)).toBe(true);
    expect(notes().find((n) => n.id === a)?.y).toBe(a0.y - NUDGE_LARGE_STEP_WORLD);
    expect(notes().find((n) => n.id === b)?.y).toBe(b0.y - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30 (negative): Backspace while editing text edits text, never deletes objects', async () => {
    await setupApp();
    await createNote(0, 0);
    selectAll();
    // Enter starts editing the single selected note.
    windowKey(key('keydown', { key: 'Enter' }));
    const ta = screen.getByTestId('sticky-editor-input');
    fireEvent.change(ta, { target: { value: 'ab' } });

    // Backspace on the window while editing: the editor owns the keyboard.
    windowKey(key('keydown', { key: 'Backspace' }));

    expect(notes()).toHaveLength(1);
    expect(notes()[0].text).toBe('ab'); // the note and its text are intact
    expect(screen.getByTestId('sticky-editor-input')).toBeTruthy(); // still editing
  });

  it('TC-31: Delete removes every selected object; selection Empty', async () => {
    await setupApp();
    await createNote(0, 0);
    await createNote(300, 0);
    await createNote(600, 0);
    selectAll();
    expect(selected()).toHaveLength(3);

    windowKey(key('keydown', { key: 'Delete' }));

    expect(notes()).toHaveLength(0);
    expect(selected()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).toBeNull();
  });
});
