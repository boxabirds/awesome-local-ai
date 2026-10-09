import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';
import {
  connectBoard,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

/** Fake provider event emitter matching the ProviderLike contract. */
function createFakeProvider() {
  const statusHandlers: Array<(e: { status: string }) => void> = [];
  const syncHandlers: Array<(b: boolean) => void> = [];
  const fake = {
    destroyed: false,
    on(event: string, handler: (a: never) => void) {
      if (event === 'status') statusHandlers.push(handler as (e: { status: string }) => void);
      if (event === 'sync') syncHandlers.push(handler as (b: boolean) => void);
    },
    destroy() {
      fake.destroyed = true;
    },
    emitStatus(status: 'connecting' | 'connected' | 'disconnected') {
      for (const h of statusHandlers) h({ status });
    },
    emitSync(synced: boolean) {
      for (const h of syncHandlers) h(synced);
    },
  };
  return fake;
}

function connect(doc: Y.Doc) {
  const fake = createFakeProvider();
  const states: string[] = [];
  const conn = connectBoard(doc, 'test-board', (s) => states.push(s), {
    providerFactory: () => fake as unknown as ProviderLike,
  });
  return { conn, fake, states };
}

// Note: role="status" (a live region) does not derive its accessible name
// from content per the ARIA accname spec, so text is queried directly and the
// role attribute is asserted separately.
function badge() {
  return screen.getByRole('status') as HTMLElement;
}

describe('ConnectionStatus badge', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-19: renders the exact texts per state and hides when connected', () => {
    let r = render(<ConnectionStatus state="connecting" />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(badge().getAttribute('data-state')).toBe('connecting');
    r.unmount();

    r = render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(badge().getAttribute('data-state')).toBe('reconnecting');
    r.unmount();

    r = render(<ConnectionStatus state="confirmed" />);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(badge().getAttribute('data-state')).toBe('confirmed');
    r.unmount();

    r = render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    r.unmount();
  });

  it('TC-20: full state machine with the fake provider and fake timers', () => {
    vi.useFakeTimers();
    const { conn, fake, states } = connect(new Y.Doc());

    // initial: Connecting…
    expect(states).toEqual(['connecting']);

    // first load: provider connects + sync -> connected (badge hidden)
    fake.emitStatus('connected');
    fake.emitSync(true);
    expect(states).toEqual(['connecting', 'connected']);

    // drop the connection -> Reconnecting…
    fake.emitStatus('disconnected');
    expect(states.at(-1)).toBe('reconnecting');

    // re-establish: connect + sync -> Connected (confirmed)
    fake.emitStatus('connecting');
    fake.emitStatus('connected');
    fake.emitSync(true);
    expect(states.at(-1)).toBe('confirmed');

    // stays confirmed until exactly CONNECTED_CONFIRMATION_MS
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    expect(states.at(-1)).toBe('confirmed');
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toBe('connected');

    conn.destroy();
    expect(fake.destroyed).toBe(true);
  });

  it('TC-21: a disconnect during the "Connected" window goes straight back to Reconnecting…', () => {
    vi.useFakeTimers();
    const { conn, fake, states } = connect(new Y.Doc());
    fake.emitStatus('connected');
    fake.emitSync(true);
    fake.emitStatus('disconnected');
    fake.emitStatus('connecting');
    fake.emitStatus('connected');
    fake.emitSync(true);
    expect(states.at(-1)).toBe('confirmed');

    // drop again before the 2s window ends
    fake.emitStatus('disconnected');
    expect(states.at(-1)).toBe('reconnecting');

    // no confirmation was "queued": still reconnecting after the window
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    expect(states.at(-1)).toBe('reconnecting');

    fake.emitStatus('connecting');
    fake.emitStatus('connected');
    fake.emitSync(true);
    expect(states.at(-1)).toBe('confirmed');
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    expect(states.at(-1)).toBe('connected');
    conn.destroy();
  });

  it('badge follows the mapped state across re-renders', () => {
    const { conn, fake, states } = connect(new Y.Doc());
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    expect(badge().getAttribute('data-state')).toBe('connecting');

    fake.emitStatus('connected');
    fake.emitSync(true);
    rerender(<ConnectionStatus state={states.at(-1) as never} />);
    expect(screen.queryByRole('status')).toBeNull();

    fake.emitStatus('disconnected');
    rerender(<ConnectionStatus state={states.at(-1) as never} />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();

    conn.destroy();
    expect(fake.destroyed).toBe(true);
  });
});
