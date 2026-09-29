import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import {
  createConnectionState,
  type ConnectionState,
  type ConnectionStateController,
} from '@client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '@shared/config';

// A driver harness: holds the current state, wires it to the real state machine and
// to the badge, and hands the controller back so tests can fire provider events.
// It also renders an editing affordance that must never be disabled by the badge.
let controller: ConnectionStateController | null = null;

function Harness() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [ctl] = useState(() =>
    createConnectionState((s) => setState(s), CONNECTED_CONFIRMATION_MS),
  );
  controller = ctl;
  return (
    <div>
      <ConnectionStatus state={state} />
      <button aria-label="edit-note">edit</button>
    </div>
  );
}

function badge() {
  return screen.queryByRole('status');
}

function drive(fn: () => void) {
  act(() => {
    fn();
  });
}

describe('sync.client — connection status badge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    controller = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-19: connecting shows "Connecting…"; first sync hides the badge', () => {
    render(<Harness />);
    const b = badge();
    expect(b).not.toBeNull();
    expect(b).toHaveAttribute('role', 'status');
    expect(b?.textContent).toContain('Connecting');

    drive(() => controller!.handleSync(true)); // first sync
    expect(badge()).toBeNull(); // hidden while healthy & connected
  });

  it('TC-20: reconnect shows "Reconnecting…", then "Connected" is visible until exactly CONNECTED_CONFIRMATION_MS then hidden', () => {
    render(<Harness />);
    drive(() => controller!.handleSync(true)); // reach connected (hidden)
    expect(badge()).toBeNull();

    // Socket drops.
    drive(() => controller!.handleStatus('disconnected'));
    const recon = badge();
    expect(recon).not.toBeNull();
    expect(recon?.textContent).toContain('Reconnecting');

    // Socket reopens and re-syncs: green confirmation appears.
    drive(() => {
      controller!.handleStatus('connected');
      controller!.handleSync(true);
    });
    expect(badge()?.textContent).toContain('Connected');

    // Still visible one millisecond before the confirmation window closes.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(badge()).not.toBeNull();
    expect(badge()?.textContent).toContain('Connected');

    // At exactly the boundary it settles back to the hidden "connected" state.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(badge()).toBeNull();
  });

  it('TC-21: dropping again during the confirmation window returns to "Reconnecting…" immediately', () => {
    render(<Harness />);
    drive(() => controller!.handleSync(true)); // connected
    drive(() => controller!.handleStatus('disconnected')); // reconnecting
    drive(() => {
      controller!.handleStatus('connected');
      controller!.handleSync(true);
    });
    expect(badge()?.textContent).toContain('Connected');

    // Drop again while the confirmation timer is still pending.
    drive(() => controller!.handleStatus('disconnected'));
    expect(badge()?.textContent).toContain('Reconnecting'); // immediate, no delay

    // The cancelled confirmation must not later hide the badge.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 10);
    });
    expect(badge()?.textContent).toContain('Reconnecting');
  });

  it('board editing stays enabled in every connection state (no lockout while reconnecting)', () => {
    render(<Harness />);
    const edit = screen.getByLabelText('edit-note');

    const checkEnabled = () => expect(edit).not.toBeDisabled();

    checkEnabled(); // connecting
    drive(() => controller!.handleStatus('disconnected'));
    checkEnabled(); // never synced yet → still connecting
    drive(() => controller!.handleSync(true)); // first sync → connected
    checkEnabled();
    drive(() => controller!.handleStatus('disconnected')); // reconnecting
    checkEnabled();
    drive(() => {
      controller!.handleStatus('connected');
      controller!.handleSync(true);
    }); // confirmed
    checkEnabled();
  });
});
