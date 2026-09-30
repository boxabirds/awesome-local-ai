// sync.client badge (TC-19, TC-20, TC-21): the connection pill's text across the
// provider's status/sync events, driven through `mapConnectionState` with a fake
// emitter and fake timers so the CONNECTED_CONFIRMATION_MS settle is exact.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect, useState, type JSX } from 'react';
import {
  mapConnectionState,
  type ConnectionEmitter,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

import { FakeConnectionEmitter as FakeEmitter } from './helpers';

function badgeText(): string | null {
  return screen.queryByTestId('connection-status')?.textContent ?? null;
}

/** Renders the badge, wired to `emitter` through `mapConnectionState`. */
function renderBadge(emitter: ConnectionEmitter): void {
  function Harness(): JSX.Element {
    const [state, setState] = useState<ConnectionState>('connecting');
    useEffect(() => mapConnectionState(emitter, setState), [emitter]);
    return <ConnectionStatus state={state} />;
  }
  render(<Harness />);
}

describe('connection badge (TC-19 to TC-21)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-19 shows "Connecting…" first load and hides once synced', () => {
    const emitter = new FakeEmitter();
    renderBadge(emitter);
    // First load, before anything syncs.
    expect(badgeText()).toBe('Connecting…');
    // Socket opens but is not synced yet: still "Connecting…".
    act(() => emitter.emitStatus('connected'));
    expect(badgeText()).toBe('Connecting…');
    // The first sync completes: connected, so the badge is gone entirely.
    act(() => emitter.emitSync(true));
    expect(badgeText()).toBeNull();
  });

  it('TC-20 outage: "Reconnecting…", then green "Connected" for the confirmation window', () => {
    const emitter = new FakeEmitter();
    renderBadge(emitter);
    // Reach the steady live state.
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitSync(true);
    });
    expect(badgeText()).toBeNull();

    // The link drops: amber "Reconnecting…", board still editable underneath.
    act(() => emitter.emitStatus('disconnected'));
    expect(badgeText()).toBe('Reconnecting…');

    // It comes back: green "Connected".
    act(() => emitter.emitStatus('connected'));
    expect(badgeText()).toBe('Connected');

    // One millisecond short of the window it is still showing.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1));
    expect(badgeText()).toBe('Connected');

    // At exactly CONNECTED_CONFIRMATION_MS it hides.
    act(() => vi.advanceTimersByTime(1));
    expect(badgeText()).toBeNull();
  });

  it('TC-21 dropping again mid-confirmation returns "Reconnecting…" at once', () => {
    const emitter = new FakeEmitter();
    renderBadge(emitter);
    act(() => {
      emitter.emitStatus('connected');
      emitter.emitSync(true);
    });
    act(() => emitter.emitStatus('disconnected'));
    act(() => emitter.emitStatus('connected')); // confirming
    expect(badgeText()).toBe('Connected');

    act(() => vi.advanceTimersByTime(500)); // still inside the window
    act(() => emitter.emitStatus('disconnected'));
    expect(badgeText()).toBe('Reconnecting…');

    // The abandoned confirmation timer must not later flip the badge to hidden.
    act(() => vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1000));
    expect(badgeText()).toBe('Reconnecting…');
  });
});
