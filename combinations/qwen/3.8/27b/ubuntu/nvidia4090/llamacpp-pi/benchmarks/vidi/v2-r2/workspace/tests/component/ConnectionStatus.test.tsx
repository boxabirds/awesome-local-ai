import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createConnectionState,
  type ConnectionState,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { canEdit } from '../../src/client/App';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { mockProviders } from './setup';
import { renderStickyBoard, type StickyBoardHarnessResult } from './harness';

/**
 * Connection status badge tests (design TC-19 to TC-21): the sync.client
 * state mapping is exercised with a fake provider event emitter and fake
 * timers; the badge contract (role, texts, hidden-when-connected,
 * pointer-events) is exercised by rendering ConnectionStatus directly;
 * the no-lockout guarantee is exercised against the real board harness.
 */

type ProviderStatus = 'connecting' | 'connected' | 'disconnected';

class FakeProvider implements ProviderLike {
  private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
  private syncHandlers: ((sync: boolean) => void)[] = [];
  private closeHandlers: ((event: { code: number } | null) => void)[] = [];
  destroyed = false;

  on(
    event: 'status',
    handler: (event: { status: ProviderStatus }) => void,
  ): void;
  on(event: 'sync', handler: (sync: boolean) => void): void;
  on(event: 'connection-close', handler: (event: { code: number } | null) => void): void;
  on(event: 'status' | 'sync' | 'connection-close', handler: unknown): void {
    if (event === 'status') {
      this.statusHandlers.push(handler as never);
    } else if (event === 'sync') {
      this.syncHandlers.push(handler as never);
    } else {
      this.closeHandlers.push(handler as never);
    }
  }

  emitStatus(status: ProviderStatus): void {
    for (const h of this.statusHandlers) {
      h({ status });
    }
  }

  emitSync(sync: boolean): void {
    for (const h of this.syncHandlers) {
      h(sync);
    }
  }

  emitConnectionClose(code: number | null): void {
    for (const h of this.closeHandlers) {
      h(code === null ? null : { code });
    }
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function collectStates(): { provider: FakeProvider; states: ConnectionState[]; destroy(): void } {
  const provider = new FakeProvider();
  const states: ConnectionState[] = [];
  const handle = createConnectionState(provider, (state) => {
    states.push(state);
  });
  return { provider, states, destroy: handle.destroy };
}

describe('connection state mapping (design sync.client)', () => {
  it('TC-19: connecting → connected: "Connecting…" then hidden', () => {
    const { provider, states, destroy } = collectStates();
    // Initial state is emitted immediately.
    expect(states).toEqual(['connecting']);
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(states).toEqual(['connecting', 'connected']);
    destroy();
    expect(provider.destroyed).toBe(true);
  });

  it('TC-20: connected → disconnected → connected: "Reconnecting…" → "Connected", hidden at exactly CONNECTED_CONFIRMATION_MS', () => {
    vi.useFakeTimers();
    try {
      const { provider, states } = collectStates();
      act(() => {
        provider.emitStatus('connected');
        provider.emitSync(true);
      });
      expect(states[states.length - 1]).toBe('connected');

      act(() => {
        provider.emitStatus('disconnected');
      });
      expect(states[states.length - 1]).toBe('reconnecting');

      act(() => {
        provider.emitStatus('connected');
        provider.emitSync(true);
      });
      expect(states[states.length - 1]).toBe('confirmed');

      // The green "Connected" badge is still up at MS − 1 …
      const { unmount } = render(<ConnectionStatus state="confirmed" />);
      expect(screen.getByTestId('connection-status').textContent).toBe('Connected');
      act(() => {
        vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
      });
      expect(states[states.length - 1]).toBe('confirmed');
      // … and the mapping returns to connected (badge hidden) at exactly MS.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(states[states.length - 1]).toBe('connected');
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-21: disconnect again during confirmation → "Reconnecting…" immediately', () => {
    vi.useFakeTimers();
    try {
      const { provider, states } = collectStates();
      act(() => {
        provider.emitStatus('connected');
        provider.emitSync(true);
      });
      act(() => {
        provider.emitStatus('disconnected');
      });
      act(() => {
        provider.emitStatus('connected');
        provider.emitSync(true);
      });
      expect(states[states.length - 1]).toBe('confirmed');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        provider.emitStatus('disconnected');
      });
      expect(states[states.length - 1]).toBe('reconnecting');
      // The stale confirmation timer must not fire afterwards.
      act(() => {
        vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
      });
      expect(states[states.length - 1]).toBe('reconnecting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fresh connect stays "connecting" until sync; never says "Reconnecting…" on first load', () => {
    const { provider, states } = collectStates();
    act(() => {
      provider.emitStatus('disconnected');
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
    });
    expect(states).toEqual(['connecting']);
    act(() => {
      provider.emitSync(true);
    });
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('TC-28: close 1011 then 1003 → reconnecting (never load_failed), editing stays enabled', () => {
    const { provider, states } = collectStates();
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(states[states.length - 1]).toBe('connected');

    // Storage failure (1011): the room is writable again on reconnect, so
    // this is a plain reconnect — not "couldn't be loaded".
    act(() => {
      provider.emitConnectionClose(CLOSE_STORAGE_FAILURE);
      provider.emitStatus('disconnected');
    });
    expect(states[states.length - 1]).toBe('reconnecting');
    expect(canEdit(states[states.length - 1])).toBe(true);

    // Garbage update (1003): also a reconnect, never load_failed.
    act(() => {
      provider.emitConnectionClose(1003);
      provider.emitStatus('disconnected');
    });
    expect(states[states.length - 1]).toBe('reconnecting');
    expect(states).not.toContain('load_failed');
    expect(canEdit(states[states.length - 1])).toBe(true);
  });

  it('close 4500 → load_failed; the next successful sync returns to connected (no reload)', () => {
    const { provider, states } = collectStates();
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(states[states.length - 1]).toBe('connected');

    // The room could not (re)load the board: close 4500.
    act(() => {
      provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
      provider.emitStatus('disconnected');
    });
    expect(states[states.length - 1]).toBe('load_failed');
    expect(canEdit(states[states.length - 1])).toBe(false);

    // The provider keeps retrying; while it retries the board stays locked.
    act(() => {
      provider.emitStatus('connecting');
    });
    expect(states[states.length - 1]).toBe('load_failed');

    // First successful sync: back to connected, editing re-enabled.
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(states[states.length - 1]).toBe('connected');
    expect(canEdit(states[states.length - 1])).toBe(true);
  });

  it('a failed INITIAL load (4500 before any sync) shows load_failed, not connecting', () => {
    const { provider, states } = collectStates();
    expect(states).toEqual(['connecting']);
    act(() => {
      provider.emitStatus('connected'); // socket opened, but the room bounces it
      provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
      provider.emitStatus('disconnected');
    });
    expect(states[states.length - 1]).toBe('load_failed');
  });
});

describe('ConnectionStatus badge contract', () => {
  it.each([
    ['connecting', 'Connecting…', 'rgb(107, 114, 128)'],   // #6b7280 grey
    ['reconnecting', 'Reconnecting…', 'rgb(217, 119, 6)'], // #d97706 amber
    ['confirmed', 'Connected', 'rgb(22, 163, 74)'],        // #16a34a green
  ] as const)('state %s renders a role=status badge with text %s', (state, text, color) => {
    render(<ConnectionStatus state={state} />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('data-connection-state')).toBe(state);
    expect(badge.textContent).toBe(text);
    // jsdom normalises hex colours to rgb() in style reads.
    expect(badge.style.color).toBe(color);
    // The badge must never intercept board input.
    expect(badge.style.pointerEvents).toBe('none');
  });

  it('state connected renders nothing', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.querySelector('[data-testid="connection-status"]')).toBeNull();
  });

  it('TC-22: load_failed renders the red "couldn\'t be loaded. Retrying…" badge', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.getAttribute('role')).toBe('status');
    expect(badge.getAttribute('data-connection-state')).toBe('load_failed');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    // jsdom normalises hex colours to rgb() in style reads (#dc2626).
    expect(badge.style.color).toBe('rgb(220, 38, 38)');
    // It must still never intercept board input.
    expect(badge.style.pointerEvents).toBe('none');
  });
});

describe('no lockout (negative)', () => {
  function driveBoard(utils: StickyBoardHarnessResult): {
    provider: (typeof mockProviders)[number];
  } {
    // Create one note through the real toolbar so there is something to edit.
    act(() => {
      fireEvent.click(screen.getByTestId('sticky-note-button'));
    });
    const provider = mockProviders[mockProviders.length - 1];
    expect(provider).toBeDefined();
    return { provider };
  }

  it('while reconnecting the badge is visible but the board stays fully editable', () => {
    const utils = renderStickyBoard({ withStatusBadge: true });
    const { provider } = driveBoard(utils);

    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();

    act(() => {
      provider.emitStatus('disconnected');
    });
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.style.pointerEvents).toBe('none');

    // Created notes start in edit mode; Escape ends editing and keeps the
    // note selected, which shows the note toolbar (selection works while
    // the badge is up).
    const note = screen.getByTestId('sticky-note');
    act(() => {
      fireEvent.keyDown(screen.getByTestId('sticky-textarea'), { key: 'Escape' });
    });
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    // … and so does editing: double-click reopens the text editor.
    act(() => {
      fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    });
    expect(screen.getByTestId('sticky-textarea')).toBeTruthy();

    // … and the doc still accepts local edits (they will sync on reconnect).
    act(() => {
      const ta = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
      ta.value = 'still editable';
      fireEvent.input(ta);
    });
    const texts = snapshot(utils.doc).map((o) => o.text);
    expect(texts).toEqual(['still editable']);
  });

  it('the badge never blocks board input: empty-board edits work while it is visible', () => {
    // The board stays fully editable while the badge is up: the badge has
    // pointer-events none and no other board behaviour depends on the
    // connection state.
    const utils = renderStickyBoard({ withStatusBadge: true });
    const { provider } = driveBoard(utils);
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(screen.getByTestId('connection-status').textContent).toBe('Reconnecting…');
    act(() => {
      const noteId = createSticky(utils.doc, { x: 1000, y: 1000 });
      expect(noteId).not.toBe('');
    });
    expect(screen.getAllByTestId('sticky-note').length).toBe(2);
  });
});

describe('load_failed board is not editable (TC-23)', () => {
  function failLoad(utils: StickyBoardHarnessResult): void {
    const provider = mockProviders[mockProviders.length - 1];
    // Establish a live board with one note, then fail the load.
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    act(() => {
      createSticky(utils.doc, { x: 200, y: 200 });
    });
    // The room bounces the connection: close 4500.
    act(() => {
      provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
      provider.emitStatus('disconnected');
    });
  }

  it('double-click, the Sticky button and Delete all no-op; the loaded board stays visible', () => {
    const utils = renderStickyBoard({ withStatusBadge: true });
    failLoad(utils);
    // The board stays visible (not blanked) with its red badge …
    expect(screen.getByTestId('connection-status').textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );
    expect(screen.getAllByTestId('sticky-note').length).toBe(1);

    const before = snapshot(utils.doc).length;

    // (a) Double-clicking empty board space creates nothing.
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: 640, clientY: 500 });
    });
    expect(snapshot(utils.doc).length).toBe(before);

    // (b) The Sticky note button is disabled and inert.
    const stickyBtn = screen.getByTestId('sticky-note-button') as HTMLButtonElement;
    expect(stickyBtn.disabled).toBe(true);
    act(() => {
      fireEvent.click(stickyBtn);
    });
    expect(snapshot(utils.doc).length).toBe(before);

    // (c) Double-clicking the existing note does not open the editor.
    const note = screen.getByTestId('sticky-note');
    act(() => {
      fireEvent.doubleClick(note, { clientX: 640, clientY: 500 });
    });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();

    // (d) A press still selects (toolbar shows) but Delete is disabled and
    // the Delete key is a no-op — the note survives.
    act(() => {
      fireEvent.pointerDown(note, { clientX: 640, clientY: 500, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 640, clientY: 500, pointerId: 1 });
    });
    const delBtn = screen.getByRole('button', { name: 'Delete note' }) as HTMLButtonElement;
    expect(delBtn.disabled).toBe(true);
    act(() => {
      fireEvent.click(delBtn);
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Delete' });
    });
    expect(snapshot(utils.doc).length).toBe(before);
    expect(screen.getAllByTestId('sticky-note').length).toBe(1);
  });

  it('editing is re-enabled on the first successful sync after load_failed (no reload)', () => {
    const utils = renderStickyBoard({ withStatusBadge: true });
    failLoad(utils);
    const stickyBtn = screen.getByTestId('sticky-note-button') as HTMLButtonElement;
    expect(stickyBtn.disabled).toBe(true);

    const provider = mockProviders[mockProviders.length - 1];
    act(() => {
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    // Badge gone, editing back on, and a double-click creates a note again.
    expect(screen.queryByTestId('connection-status')).toBeNull();
    expect(stickyBtn.disabled).toBe(false);
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: 640, clientY: 500 });
    });
    expect(screen.getAllByTestId('sticky-note').length).toBe(2);
  });
});
