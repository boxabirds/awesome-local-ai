/**
 * A board whose storage could not be read (story 4, task 5): TC-22, TC-23, TC-28.
 *
 * Two halves. First, what the close code means to the page: `4500` is not an
 * outage, it is "this board could not be read", and the page has to tell those
 * apart because the board is read-only in one case and perfectly editable in the
 * other. Then what that state does to the board: notes cannot be created, moved,
 * recoloured, deleted or typed into, while panning and zooming carry on working.
 *
 * The transport is a fake provider that emits exactly the events `y-websocket`
 * emits, so the close code is the only thing under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo } from 'react';
import * as Y from 'yjs';

const { FakeProvider } = vi.hoisted(() => {
  class FakeProvider {
    static readonly instances: FakeProvider[] = [];

    readonly url: string;
    readonly roomName: string;
    readonly doc: Y.Doc;
    synced = false;
    destroyed = false;

    private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(url: string, roomName: string, doc: Y.Doc) {
      this.url = url;
      this.roomName = roomName;
      this.doc = doc;
      FakeProvider.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }

    off(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
    }

    destroy(): void {
      this.destroyed = true;
      this.handlers.clear();
    }

    // --- what a real provider does, driven by the test ----------------------

    /** Socket open and the document exchanged. */
    sync(): void {
      this.emit('status', { status: 'connected' });
      this.synced = true;
      this.emit('sync', true);
    }

    /** Socket dropped (Wi-Fi gone). */
    drop(): void {
      this.synced = false;
      this.emit('status', { status: 'disconnected' });
    }

    /**
     * The server hung up, code in hand. A real close event arrives before the
     * `disconnected` status, and only when the socket had been usable.
     */
    close(code: number): void {
      const hadConnected = this.synced;
      this.synced = false;
      this.emit('connection-close', { code, reason: 'the server said so' }, this);
      if (hadConnected) this.emit('status', { status: 'disconnected' });
    }
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }));

// Imported after the mock is registered, so nothing touches the real transport.
const { connectBoard, canEdit } = await import('../../src/client/sync/connectBoard');
type ConnectionState = import('../../src/client/sync/connectBoard').ConnectionState;
const { ConnectionStatus } = await import('../../src/client/sync/ConnectionStatus');
const App = (await import('../../src/client/App')).default;
const { snapshot } = await import('../../src/shared/board-model');
const { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } = await import(
  '../../src/shared/protocol'
);
const { CONNECTED_CONFIRMATION_MS } = await import('../../src/shared/config');
const {
  boardSurface,
  clickNote,
  noteEl,
  seedSticky,
  stubViewportSize,
  worldLayer,
} = await import('./boardHarness');

type FakeProviderInstance = InstanceType<typeof FakeProvider>;

/** The badge the app itself renders, or null when nothing is being reported. */
function badge(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-connection-state]');
}

const BOARD_ID = 'abcdefghijklmnopqrstuvwx';
const LOAD_MESSAGE = 'This board couldn\u2019t be loaded. Retrying\u2026';

function lastProvider(): FakeProviderInstance {
  return FakeProvider.instances[FakeProvider.instances.length - 1]!;
}

beforeEach(() => {
  FakeProvider.instances.length = 0;
});

afterEach(() => {
  cleanup();
});

// --- the close code, and what the page makes of it (TC-28) -----------------

/** The smallest thing that can hold a connection: a collector of state changes. */
function Probe({ onState }: { onState: (state: ConnectionState) => void }): null {
  const doc = useMemo(() => new Y.Doc(), []);
  useEffect(() => {
    const connection = connectBoard(doc, BOARD_ID, onState);
    return () => connection.destroy();
  }, [doc, onState]);
  return null;
}

describe('what a close code means to the page (TC-28)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function tracked(): { states: ConnectionState[]; provider: FakeProviderInstance } {
    const states: ConnectionState[] = [];
    render(<Probe onState={(next) => states.push(next)} />);
    return { states, provider: lastProvider() };
  }

  it('reports the load-failure code as load_failed', () => {
    const { states, provider } = tracked();
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(states).toEqual(['load_failed']);
    expect(canEdit('load_failed')).toBe(false);
  });

  it('treats every other code as an outage, never as a load failure', () => {
    // 1011 is a storage failure: the board is readable and the page's own changes
    // go out again on reconnect. 1003, 1006, 1012 and 4999 are outages too.
    for (const code of [CLOSE_STORAGE_FAILURE, 1003, 1006, 1012, 4999]) {
      const { states, provider } = tracked();
      act(() => {
        provider.sync();
        provider.close(code);
      });
      expect(states, `close code ${code}`).toEqual(['connected', 'reconnecting']);
      expect(states).not.toContain('load_failed');
      expect(canEdit(states[states.length - 1] as ConnectionState), `code ${code} stays editable`).toBe(
        true,
      );
      cleanup();
    }
  });

  it('notices a load failure inside the confirmation window', () => {
    const { states, provider } = tracked();
    act(() => {
      provider.sync();
      provider.drop();
      provider.sync(); // recovered: "Connected", for CONNECTED_CONFIRMATION_MS
    });
    expect(states[states.length - 1]).toBe('confirmed');

    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(states[states.length - 1]).toBe('load_failed');

    // And the green confirmation does not arrive afterwards to overwrite it.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 10);
    });
    expect(states[states.length - 1]).toBe('load_failed');
  });

  it('stays on the load-failure message while the connection keeps retrying', () => {
    const { states, provider } = tracked();
    act(() => {
      provider.sync();
      provider.close(CLOSE_BOARD_LOAD_FAILED);
    });
    // A retry that opens the socket but never syncs: still broken.
    act(() => provider.emit('status', { status: 'connected' }));
    expect(states[states.length - 1]).toBe('load_failed');
  });

  it('is editable again the moment a board loads, without a reload', () => {
    const { states, provider } = tracked();
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(canEdit(states[states.length - 1] as ConnectionState)).toBe(false);

    // The retry succeeds: the board is live again, with no reload in between.
    act(() => provider.sync());
    expect(canEdit(states[states.length - 1] as ConnectionState)).toBe(true);
    expect(states[states.length - 1], 'the badge left the failure state').not.toBe('load_failed');
  });
});

// --- the message (TC-22) ---------------------------------------------------

describe('the message a returning person sees (TC-22)', () => {
  it('says the board could not be loaded and that it is retrying', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe(LOAD_MESSAGE);
    expect(badge.getAttribute('data-connection-state')).toBe('load_failed');
  });

  it('appears on the board when the room closes the connection with 4500', () => {
    const { container } = render(<App boardId={BOARD_ID} />);
    const provider = lastProvider();
    act(() => provider.sync());
    expect(badge(container)).toBeNull();

    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(badge(container)?.textContent).toContain(LOAD_MESSAGE);
    expect(badge(container)?.getAttribute('data-connection-state')).toBe('load_failed');
  });

  it('does not appear for an ordinary outage', () => {
    const { container } = render(<App boardId={BOARD_ID} />);
    const provider = lastProvider();
    act(() => {
      provider.sync();
      provider.drop();
    });
    expect(badge(container)?.textContent ?? '').not.toContain(LOAD_MESSAGE);
    expect(badge(container)?.getAttribute('data-connection-state')).toBe('reconnecting');
  });
});

// --- the read-only board (TC-23) -------------------------------------------

describe('a board that could not be loaded is read-only (TC-23)', () => {
  stubViewportSize();

  function liveBoard(): {
    provider: FakeProviderInstance;
    doc: Y.Doc;
    container: HTMLElement;
  } {
    const { container } = render(<App boardId={BOARD_ID} />);
    const provider = lastProvider();
    act(() => provider.sync());
    return { provider, doc: provider.doc, container };
  }

  it('takes changes normally while the board is readable', () => {
    const { container, doc, provider } = liveBoard();
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(snapshot(doc)).toHaveLength(1);

    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    // The note that was created while things worked is still on screen.
    expect(snapshot(doc)).toHaveLength(1);
    expect(container.querySelectorAll('[data-sticky-note]')).toHaveLength(1);
  });

  it('refuses to create, move, recolour, delete or type, and still pans', () => {
    const { container, doc, provider } = liveBoard();
    const id = seedSticky(provider.doc, { x: 100, y: 40 }, { text: 'already there' });
    const before = snapshot(doc).find((note) => note.id === id)!;
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));

    // The board says what is wrong.
    expect(badge(container)?.textContent).toContain(LOAD_MESSAGE);
    // ... and the viewport announces that it is locked.
    const viewport = container.querySelector<HTMLElement>('.board-viewport')!;
    expect(viewport.getAttribute('data-locked')).toBe('true');

    // 1. The toolbar button is disabled and does nothing.
    const create = screen.getByRole('button', { name: 'Sticky note' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(create);
    expect(snapshot(doc)).toHaveLength(1);

    // 2. Double-clicking empty board space creates nothing.
    fireEvent.dblClick(boardSurface(container));
    expect(snapshot(doc)).toHaveLength(1);

    // 3. A note can be selected, but not dragged.
    const note = noteEl(container, id);
    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 200, clientY: 180, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 200, clientY: 180, button: 0, pointerId: 1 });
    expect(note.getAttribute('data-selected')).toBe('true');
    const after = snapshot(doc).find((n) => n.id === id)!;
    expect([after.x, after.y, after.z]).toEqual([before.x, before.y, before.z]);

    // 4. No colour or bin toolbar for a selected note.
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();

    // 5. Double-clicking the note does not open the text editor.
    fireEvent.dblClick(note);
    expect(container.querySelector('[data-sticky-textarea]')).toBeNull();

    // 6. The Delete key does not remove it either.
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);

    // 7. Navigation is untouched: the wheel still moves the board.
    const transform = worldLayer(container).style.transform;
    fireEvent.wheel(boardSurface(container), { deltaY: 100, clientX: 0, clientY: 0 });
    expect(worldLayer(container).style.transform).not.toBe(transform);
  });

  it('refuses the Delete key on a selected note without touching the document', () => {
    const { container, doc, provider } = liveBoard();
    const id = seedSticky(doc, { x: 0, y: 0 });
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    clickNote(noteEl(container, id));
    expect(noteEl(container, id).getAttribute('data-selected')).toBe('true');
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc).map((note) => note.id)).toEqual([id]);
  });
});
