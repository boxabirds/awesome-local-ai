import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

// Story 5: mock the api module so the BoardPage existence check passes
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }),
}));

import { App } from '../../src/client/App';
import { setProviderFactoryForTest } from '../../src/client/sync/connectBoard';
import { createSticky, getStickyText } from '../../src/shared/board-model';
import { enableFakeFrameTimers, flushFrames } from './test-utils';

/**
 * Story 4 TC-23 (part 2): the FULL App in `load_failed`, driven through the
 * real connectBoard wiring with a fake provider (setProviderFactoryForTest).
 *
 * The room rejects the connection with CLOSE_BOARD_LOAD_FAILED (4500). While
 * the board is locked, every mutation entry point is a no-op: board dblclick
 * and the Sticky note button (disabled) create nothing, Delete on a selected
 * note does not delete, dragging does not move, double-click does not open
 * the editor, and the note toolbar's colour/delete buttons are disabled.
 * The first successful sync recovers without a reload: creating works again.
 *
 * (The close-code mapping itself — 4500 vs 1011 vs sync — is covered at the
 * state-machine level in ConnectionStatus.test.tsx.)
 */

type Handler = (...args: never[]) => void;

/** Minimal y-websocket double: the same observable surface connectBoard uses. */
class FakeProvider {
  doc: Y.Doc | null = null;
  synced = false;
  destroyed = false;
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  destroy(): void {
    this.destroyed = true;
  }

  // --- test drivers: emit exactly what the real provider emits -------------

  close(code?: number): void {
    this.emit('connection-close', [{ code, reason: '' }, this]);
  }

  status(s: 'connecting' | 'connected' | 'disconnected'): void {
    this.emit('status', [{ status: s }]);
  }

  sync(state: boolean): void {
    this.synced = state;
    this.emit('sync', [state]);
  }

  private emit(event: string, args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...(args as never[]));
  }
}

const notes = (): readonly { id: string; x: number; y: number; text: string; color: string }[] =>
  window.__vidi6!.getNotes();

const viewport = () => document.querySelector('.vidi6-viewport') as HTMLElement;
const noteEl = () => screen.getByRole('group', { name: 'Sticky note' }) as HTMLElement;

/** Seed one note into the room's doc from test code (a "remote" peer). */
function seedNote(fake: FakeProvider, x: number, y: number, text: string): void {
  act(() => {
    const id = createSticky(fake.doc!, { x, y });
    getStickyText(fake.doc!, id)!.insert(0, text);
  });
}

describe('persist.client_status App edit lock (story 4, TC-23)', () => {
  afterEach(() => {
    setProviderFactoryForTest(null); // restore the real WebsocketProvider
  });

  it('4500 locks every mutation entry point; the next sync re-enables editing without reload', async () => {
    enableFakeFrameTimers();
    const fake = new FakeProvider();
    // The factory also captures the doc so the fake can seed "remote" state.
    setProviderFactoryForTest((url, boardId, doc) => {
      fake.doc = doc;
      return fake as unknown as WebsocketProvider;
    });

    // Story 5: App now uses a router. Set the URL to a board path.
    window.history.pushState(null, '', '/b/testboardid12345678901');

    render(<App />);

    // Wait for the board to connect (fake.doc to be set).
    // Temporarily switch to real timers to let the async existence check
    // and connectBoard complete, then switch back to fake timers.
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    // The room holds one note; the client has synced it.
    seedNote(fake, 0, 0, 'keep me');
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.text).toBe('keep me');

    // The room rejects the connection: the board could not be loaded.
    act(() => fake.close(4500)); // CLOSE_BOARD_LOAD_FAILED
    const badge = screen.getByText('This board couldn’t be loaded. Retrying…');
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.className).toContain('vidi6-badge--error');
    expect(window.__vidi6!.connectionState ?? null).toBe('load_failed');

    const before = notes();
    const note = noteEl();

    // 1. Board dblclick: nothing created.
    fireEvent.doubleClick(viewport(), { clientX: 50, clientY: 50 });
    expect(notes()).toHaveLength(1);

    // 2. Sticky note button: disabled, and clicking it creates nothing.
    const createButton = screen.getByRole('button', { name: 'Sticky note' }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    fireEvent.click(createButton);
    expect(notes()).toHaveLength(1);

    // 3. Delete on a (focus-selected) note: no-op.
    act(() => note.focus());
    expect(note.getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(notes()).toHaveLength(1);

    // 4. Drag beyond the threshold: the note stays put.
    const origin = notes()[0]!;
    fireEvent.pointerDown(note, { button: 0, clientX: 512, clientY: 384, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 560, clientY: 420 });
    flushFrames(); // any (locked) move would apply here
    fireEvent.pointerUp(note, { clientX: 560, clientY: 420, pointerId: 1 });
    expect(notes()[0]!.x).toBe(origin.x);
    expect(notes()[0]!.y).toBe(origin.y);

    // 5. Double-click on the note: no editor opens, typing reaches no doc.
    fireEvent.doubleClick(note, { clientX: 512, clientY: 384 });
    expect(screen.queryByRole('textbox', { name: 'Sticky note text' })).toBeNull();
    fireEvent.keyDown(window, { key: 'a' });
    expect(notes()[0]!.text).toBe('keep me');

    // 6. Note toolbar: colour swatches and delete are disabled.
    const swatches = screen.getAllByRole('button', { name: /colour/ });
    expect(swatches.length).toBeGreaterThan(0);
    for (const swatch of swatches) expect((swatch as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete note' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // Recovery: the provider's retry lands and state is exchanged. No reload.
    act(() => fake.status('connected'));
    act(() => fake.sync(true));
    expect(window.__vidi6!.connectionState ?? null).toBe('connected');
    expect(screen.queryByText('This board couldn’t be loaded. Retrying…')).toBeNull();

    // Editing works again: dblclick creates a second note.
    fireEvent.doubleClick(viewport(), { clientX: 50, clientY: 50 });
    expect(notes()).toHaveLength(2);
  });
});
