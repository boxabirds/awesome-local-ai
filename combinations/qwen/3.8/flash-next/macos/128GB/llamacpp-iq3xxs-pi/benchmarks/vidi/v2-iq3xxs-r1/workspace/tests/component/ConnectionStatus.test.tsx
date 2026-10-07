import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import type { ConnectOptions } from '../../src/client/sync/connectBoard';
import { FakeClock, FakeProvider } from './fake-sync';

/**
 * Story 3 — the connection badge (TC-19, TC-20, TC-21).
 *
 * The badge is about *this connection*, so it is driven from the provider's own
 * events: a fake provider emits `status` / `sync` exactly as `y-websocket` does,
 * and a fake clock makes the confirmation window measurable. Nothing here opens a
 * socket: what is under test is how four connection states become one polite
 * status line — and that the board is never disabled because of them.
 */
function renderConnectedBoard(): {
  provider: FakeProvider;
  clock: FakeClock;
  /** Join the room and reach the first sync (the state a normal board is in). */
  goToConnected(): void;
} {
  const provider = new FakeProvider();
  const clock = new FakeClock();
  const connect: ConnectOptions = { after: clock.after };

  render(<App boardId={newBoardId()} sync connect={connect} provider={provider} />);

  const goToConnected = (): void => {
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();
  };

  return { provider, clock, goToConnected };
}

/** The badge text, or null when nothing is rendered (a synced board shows none). */
function badge(): { text: string; state: string } | null {
  const el = screen.queryByTestId('connection-status');
  if (!el) return null;
  return { text: el.textContent ?? '', state: el.getAttribute('data-state') ?? '' };
}

describe('connection badge (TC-19)', () => {
  it('says "Connecting…" until the first sync, then renders nothing at all', () => {
    const { provider } = renderConnectedBoard();

    // A fresh board has never seen its room: "Connecting…".
    expect(badge()).toEqual({ text: 'Connecting…', state: 'connecting' });

    // A socket that is merely open is not a board that is in sync.
    act(() => provider.emitStatus('connected'));
    expect(badge()?.text).toBe('Connecting…');

    // The first sync means the board is live — and no confirmation is shown for a
    // first connection, because there was nothing to come back from.
    act(() => provider.emitSync(true));
    expect(badge()).toBeNull();
  });

  it('is a polite live region that never covers the board controls', () => {
    const { provider } = renderConnectedBoard();
    const el = screen.getByTestId('connection-status');
    expect(el.getAttribute('role')).toBe('status');

    // While the badge is up, the board is not locked: creating a note works.
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);

    act(() => provider.emitSync(true));
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(2);
  });
});

describe('reconnection badge (TC-20)', () => {
  it('warns while a dropped connection is being replaced, confirms it, then hides', () => {
    const { provider, clock, goToConnected } = renderConnectedBoard();
    goToConnected();

    // A board that had synced loses its connection: the board becomes local-only
    // and the warning appears.
    act(() => provider.emitStatus('disconnected'));
    expect(badge()).toEqual({ text: 'Reconnecting…', state: 'reconnecting' });

    // Retrying is still reconnecting — the first-run wording must not come back.
    act(() => provider.emitStatus('connecting'));
    expect(badge()?.text).toBe('Reconnecting…');
    act(() => provider.emitStatus('connected'));
    expect(badge()?.text).toBe('Reconnecting…'); // not in sync yet

    // Re-synced: the green confirmation replaces the warning...
    act(() => provider.emitSync(true));
    expect(badge()).toEqual({ text: 'Connected', state: 'confirmed' });

    // ...and is armed for exactly the configured window.
    expect(clock.pending()).toHaveLength(1);
    expect(clock.pending()[0]?.remaining).toBe(CONNECTED_CONFIRMATION_MS);

    // Still visible just before the boundary...
    act(() => clock.advance(CONNECTED_CONFIRMATION_MS - 1));
    expect(badge()).toEqual({ text: 'Connected', state: 'confirmed' });

    // ...and hidden at exactly the boundary.
    act(() => clock.advance(1));
    expect(badge()).toBeNull();
  });

  it('keeps the board editable and keeps edits made while disconnected', () => {
    const { provider, goToConnected } = renderConnectedBoard();
    goToConnected();

    act(() => provider.emitStatus('disconnected'));
    expect(badge()?.text).toBe('Reconnecting…');

    // Offline edits are never blocked, and never lost: they are in the document,
    // waiting to be merged when the connection returns.
    fireEvent.click(screen.getByTestId('create-sticky'));
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);

    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);
  });
});

describe('second disconnection during the confirmation (TC-21)', () => {
  it('replaces "Connected" with "Reconnecting…" immediately and hides the confirmation', () => {
    const { provider, clock, goToConnected } = renderConnectedBoard();
    goToConnected();

    act(() => provider.emitStatus('disconnected'));
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(badge()).toEqual({ text: 'Connected', state: 'confirmed' });

    // The confirmation does not survive another disconnection: the warning wins,
    // and its timer is cancelled rather than being allowed to hide the warning.
    act(() => provider.emitStatus('disconnected'));
    expect(badge()).toEqual({ text: 'Reconnecting…', state: 'reconnecting' });
    expect(clock.pending()).toHaveLength(0);

    act(() => clock.advance(CONNECTED_CONFIRMATION_MS + 1));
    expect(badge()).toEqual({ text: 'Reconnecting…', state: 'reconnecting' });
  });

  it('leaves the connection when the board is left, and reports what it did', () => {
    const provider = new FakeProvider();
    const clock = new FakeClock();
    const first = render(
      <App
        boardId={newBoardId()}
        sync
        connect={{ after: clock.after }}
        provider={provider}
      />,
    );
    act(() => provider.emitSync(true));
    expect(provider.destroyed).toBe(false);

    // Leaving the board (unmount) is what closes the socket: story 3 has no other
    // way out of a board.
    act(() => first.unmount());
    expect(provider.disconnected).toBe(true);
    expect(provider.destroyed).toBe(true);
  });
});
