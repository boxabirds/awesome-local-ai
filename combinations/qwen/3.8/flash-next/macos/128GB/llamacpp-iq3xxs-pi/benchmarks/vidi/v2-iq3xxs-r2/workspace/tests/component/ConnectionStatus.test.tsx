import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTED_LABEL,
  CONNECTING_LABEL,
  CONNECTION_STATUS_LABEL,
  ConnectionStatus,
  RECONNECTING_LABEL,
} from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  boardNotes,
  createNoteViaButton,
  noteElements,
  renderBoard,
} from './fixtures/board';
import { socketsDrop, socketsLive } from './fixtures/socket';

/**
 * The badge on its own, with the fake timers the design asks for: the confirmation
 * window is a boundary value (`CONNECTED_CONFIRMATION_MS - 1` and exactly that), and a
 * test that waited for it in real time would be slow and still not exactly on the edge.
 */
class Badge {
  private readonly view: RenderResult;

  constructor(state: ConnectionState) {
    this.view = render(<ConnectionStatus state={state} />);
  }

  /** Somebody else's screen moving from one connection state to the next. */
  show(state: ConnectionState): void {
    act(() => {
      this.view.rerender(<ConnectionStatus state={state} />);
    });
  }

  /** The badge's own clock. */
  advance(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  get element(): HTMLElement | null {
    return screen.queryByRole('status', { name: CONNECTION_STATUS_LABEL });
  }

  get text(): string | null {
    return this.element?.textContent ?? null;
  }

  /** Amber while the board is not live, green for the moment it is back. */
  get tone(): 'pending' | 'ok' | null {
    const className = this.element?.className ?? '';
    if (className.includes('--pending')) return 'pending';
    if (className.includes('--ok')) return 'ok';
    return null;
  }
}

describe('connection status badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19 says Connecting… during the first load and goes quiet once live', () => {
    const badge = new Badge('connecting');
    expect(badge.text).toBe(CONNECTING_LABEL);
    expect(badge.tone).toBe('pending');

    badge.show('connected');
    expect(badge.element).toBeNull();
  });

  it('TC-20 shows Reconnecting… during an outage and Connected for exactly the confirmation window', () => {
    const badge = new Badge('connected');
    expect(badge.element).toBeNull();

    badge.show('reconnecting');
    expect(badge.text).toBe(RECONNECTING_LABEL);
    expect(badge.tone).toBe('pending');

    badge.show('confirmed');
    expect(badge.text).toBe(CONNECTED_LABEL);
    expect(badge.tone).toBe('ok');

    badge.advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge.text).toBe(CONNECTED_LABEL);

    badge.advance(1);
    expect(badge.element).toBeNull();
  });

  it('TC-21 goes straight back to Reconnecting… if the connection drops during the confirmation', () => {
    const badge = new Badge('reconnecting');
    badge.show('confirmed');
    expect(badge.text).toBe(CONNECTED_LABEL);

    badge.advance(CONNECTED_CONFIRMATION_MS - 1);
    badge.show('reconnecting');
    expect(badge.text).toBe(RECONNECTING_LABEL);
    expect(badge.tone).toBe('pending');

    // And the window that never finished does not fire later: the badge stays put.
    badge.advance(CONNECTED_CONFIRMATION_MS + 1);
    expect(badge.text).toBe(RECONNECTING_LABEL);
  });
});

describe('the board while it is reconnecting', () => {
  it('says Reconnecting… and still takes the note', async () => {
    await renderBoard();
    const badge = () => screen.queryByRole('status', { name: CONNECTION_STATUS_LABEL });
    // The room answers, the badge has nothing to report, and the note is made.
    await act(async () => {
      await socketsLive();
    });
    await waitFor(() => expect(badge()).toBeNull());
    await act(async () => {
      await createNoteViaButton();
    });

    // Somebody pulls the cable. The badge appears and the board does not notice.
    socketsDrop();
    await waitFor(() => expect(badge()?.textContent).toBe(RECONNECTING_LABEL));
    await act(async () => {
      await createNoteViaButton();
    });
    expect(noteElements()).toHaveLength(2);
    expect(boardNotes().map((note) => note.text)).toEqual(['', '']);
  });
});
