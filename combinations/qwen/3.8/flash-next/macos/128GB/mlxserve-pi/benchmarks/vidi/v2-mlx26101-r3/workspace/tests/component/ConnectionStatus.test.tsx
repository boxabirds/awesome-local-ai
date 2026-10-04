/**
 * The connection badge on its own, with its states fed in by hand.
 *
 * What is under test here is the message, not the network: which of the three sentences is on
 * screen as the connection's state moves, and how long the way-back message stays up. The
 * confirmation timing uses fake timers so that "still up at 1999 ms, gone at 2000 ms" is a
 * fact about the code rather than about how fast the machine running the test happens to be.
 */

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

/**
 * Fake the clock the badge waits on, and only that: React's own scheduling keeps running on
 * real time, as it does in the rest of the component tests.
 */
function fakeClock(): void {
  // The setup file already fakes `requestAnimationFrame` for every component test, and a
  // second call while timers are faked does not widen what is faked - so the clock is put
  // aside and re-set up with the one timer this badge waits on.
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/** Move the clock on, and let whatever the badge does with it happen. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The sentence on screen, or null when the badge shows nothing at all. */
function badge(): string | null {
  const element = screen.queryByTestId('connection-status');
  return element === null ? null : element.textContent;
}

describe('TC-19 the badge while a board is first opened', () => {
  it('says Connecting… and then says nothing once the board is there', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    expect(badge()).toBe('Connecting…');

    // The first board arriving is not news: the badge goes away rather than announcing
    // "Connected", because being connected is the normal state of a board.
    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
  });

  it('says nothing at all to someone who was never away', () => {
    render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();
  });

  it('names the connection loss it is in', () => {
    render(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toBe('Reconnecting…');
    expect(screen.getByTestId('connection-status')).toHaveAttribute('role', 'status');
  });
});

describe('TC-20 the badge across an interruption', () => {
  it('shows Connected for exactly CONNECTED_CONFIRMATION_MS after the way back', () => {
    fakeClock();
    const { rerender } = render(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();

    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toBe('Reconnecting…');

    // Back. The way home is worth a message, and it is the shorter one.
    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBe('Connected');

    advance(CONNECTED_CONFIRMATION_MS - 1);
    expect(badge()).toBe('Connected');

    advance(1);
    expect(badge()).toBeNull();
  });

  it('shows the same message when the connection announces the way back itself', () => {
    fakeClock();
    const { rerender } = render(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toBe('Reconnecting…');

    rerender(<ConnectionStatus state="confirmed" />);
    expect(badge()).toBe('Connected');

    advance(CONNECTED_CONFIRMATION_MS);
    expect(badge()).toBeNull();
  });

  it('says nothing when a first load finishes, and still says nothing on the next state change', () => {
    fakeClock();
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    expect(badge()).toBe('Connecting…');

    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBeNull();

    // No timer was started for a confirmation that never happened, so nothing can pop up later.
    advance(CONNECTED_CONFIRMATION_MS * 2);
    expect(badge()).toBeNull();

    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toBe('Reconnecting…');
  });
});

describe('TC-21 the badge when the way back does not hold', () => {
  it('goes straight back to Reconnecting… in the middle of the confirmation', () => {
    fakeClock();
    const { rerender } = render(<ConnectionStatus state="connected" />);
    rerender(<ConnectionStatus state="reconnecting" />);
    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBe('Connected');

    // A second interruption while "Connected" is up: no waiting for the timer, no moment where
    // the person is told everything is fine while it plainly is not.
    rerender(<ConnectionStatus state="reconnecting" />);
    expect(badge()).toBe('Reconnecting…');

    advance(CONNECTED_CONFIRMATION_MS);
    expect(badge()).toBe('Reconnecting…');

    // And it still comes back normally afterwards.
    rerender(<ConnectionStatus state="connected" />);
    expect(badge()).toBe('Connected');
    advance(CONNECTED_CONFIRMATION_MS);
    expect(badge()).toBeNull();
  });

  it('is ready to say it again after a third interruption', () => {
    fakeClock();
    const states: ConnectionState[] = [
      'connected',
      'reconnecting',
      'connected',
      'reconnecting',
      'connected',
      'reconnecting',
      'connected',
    ];
    const { rerender } = render(<ConnectionStatus state={states[0]!} />);
    const seen: (string | null)[] = [];
    for (const state of states.slice(1)) {
      rerender(<ConnectionStatus state={state} />);
      seen.push(badge());
      advance(CONNECTED_CONFIRMATION_MS);
      seen.push(badge());
    }
    expect(seen).toEqual([
      'Reconnecting…',
      'Reconnecting…',
      'Connected',
      null,
      'Reconnecting…',
      'Reconnecting…',
      'Connected',
      null,
      'Reconnecting…',
      'Reconnecting…',
      'Connected',
      null,
    ]);
  });
});
