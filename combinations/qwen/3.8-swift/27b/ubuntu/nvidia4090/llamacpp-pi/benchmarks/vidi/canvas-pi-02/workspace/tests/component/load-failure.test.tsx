// Story 4 (persist.client_status) — ui-component tests: TC-22 (red badge),
// TC-23 (edit lock in the full App) and the close-code mapping through the
// real connection tracker. The y-websocket provider is replaced with a fake
// that lets the tests drive status/sync/close-code events exactly as the
// room would send them.

import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAppAt } from './render-app';
import {
  canEdit,
  createConnectionTracker,
  type ConnectionTracker,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
} from '../../src/shared/protocol';
import { createSticky } from '../../src/shared/board-model';
import * as Y from 'yjs';

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

import { WebsocketProvider } from 'y-websocket';

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

/** The provider created by the last rendered App. */
function lastProvider(): FakeProvider {
  const all = fakeProviders();
  if (all.length === 0) throw new Error('no provider created');
  return all[all.length - 1];
}

/** jsdom has no PointerEvent; dispatch a plain event carrying pointer fields. */
function pointerEvent(type: string, x: number, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true });
  return e;
}

/** Dispatch a synthetic event and let React flush the resulting work. */
function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

const badge = () => screen.queryByTestId('connection-status');
const noteCount = (doc: Y.Doc): number => doc.getMap('objects').size;

/** Renders <App/>, connects, syncs, and (when `fail`) closes with the
 *  board-load-failed code; returns the provider's doc. */
async function setupApp(fail: boolean): Promise<Y.Doc> {
  await renderAppAt();
  const provider = lastProvider();
  act(() => provider.open());
  act(() => provider.doSync());
  expect(badge()).toBeNull(); // connected
  if (fail) {
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
  }
  return provider.doc;
}

describe('load-failed badge (story 4 persist.client_status)', () => {
  it('TC-22: load_failed shows the red "This board couldn\'t be loaded. Retrying…" status', async () => {
    const doc = await setupApp(true);
    expect(noteCount(doc)).toBe(0);
    expect(badge()).not.toBeNull();
    expect(badge()).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge()).toHaveAttribute('role', 'status');
    expect(badge()?.className).toContain('is-red');
  });
});

describe('close-code mapping (story 4 persist.client_status)', () => {
  it('4500 → load_failed (locked); 1011 → reconnecting (not locked); later sync → connected (unlocked)', () => {
    let state: ConnectionState = 'connecting';
    const tracker: ConnectionTracker = createConnectionTracker((s) => (state = s));

    // A normal outage after a connection: reconnecting, board stays editable.
    tracker.feed('connected', true);
    tracker.feed('disconnected', false, CLOSE_STORAGE_FAILURE);
    expect(state).toBe('reconnecting');
    expect(canEdit(state)).toBe(true);

    // The room reports it cannot load the board: locked.
    tracker.feed('connected', true);
    tracker.feed('disconnected', false, CLOSE_BOARD_LOAD_FAILED);
    expect(state).toBe('load_failed');
    expect(canEdit(state)).toBe(false);

    // The provider keeps retrying in the background; the lock holds…
    tracker.feed('connecting', false);
    tracker.feed('disconnected', false);
    expect(state).toBe('load_failed');
    expect(canEdit(state)).toBe(false);

    // …until the first successful sync, which recovers straight to the
    // stable connected state (editing re-enabled, no reload).
    tracker.feed('connected', true);
    expect(state).toBe('connected');
    expect(canEdit(state)).toBe(true);
  });
});

describe('edit lock in the App (story 4 persist.client_status)', () => {
  it('TC-23: load_failed — double-click, button, Delete, drag and typing all leave the doc untouched', async () => {
    const doc = await setupApp(true);

    // A note on the board (created directly on the doc before the lock).
    act(() => {
      createSticky(doc, { x: 40, y: 40 });
    });
    expect(noteCount(doc)).toBe(1);
    const note = screen.getByTestId('sticky-note');
    const x0 = Number.parseFloat(note.style.left);
    const y0 = Number.parseFloat(note.style.top);

    // 1. Double-click on empty board space: no note created.
    fire(screen.getByTestId('board-viewport'), new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(noteCount(doc)).toBe(1);

    // 2. The Sticky note button is disabled.
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button).toBeDisabled();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(noteCount(doc)).toBe(1);

    // 3. Delete with the note selected: the note survives.
    fire(note, pointerEvent('pointerdown', 60, 60));
    expect(note).toHaveAttribute('data-selected', 'true');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    expect(noteCount(doc)).toBe(1);

    // 4. Drag: the note does not move.
    fire(note, pointerEvent('pointerdown', 60, 60));
    fire(note, pointerEvent('pointermove', 160, 160));
    fire(note, pointerEvent('pointerup', 160, 160));
    expect(note.style.left).toBe(`${x0}px`);
    expect(note.style.top).toBe(`${y0}px`);

    // 5. Double-click to edit: no editor appears, no doc mutation.
    fire(note, new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(note).not.toHaveAttribute('data-editing');
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(noteCount(doc)).toBe(1);
  });

  it('recovery: after a successful sync the board unlocks without a reload', async () => {
    const doc = await setupApp(true);
    expect(badge()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sticky note' })).toBeDisabled();

    // The provider's next successful sync recovers the board.
    const provider = lastProvider();
    act(() => provider.open());
    act(() => provider.doSync());
    expect(badge()).toBeNull();
    expect(screen.getByRole('button', { name: 'Sticky note' })).toBeEnabled();

    // And creating works again.
    fire(screen.getByTestId('board-viewport'), new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(noteCount(doc)).toBe(1);
  });
});
