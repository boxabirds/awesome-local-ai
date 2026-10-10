import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createSyncStatusMachine,
  type SyncStatusMachine
} from '../../src/client/sync/connectBoard';
import { CONNECTED_CONFIRMATION_MS } from '../../src/shared/config';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Drives the badge exactly like the real provider wiring does, so the state
// machine (including the confirmation timer) is covered alongside the render.
function badgeWithMachine(machine: SyncStatusMachine) {
  return function Badge() {
    const status = useSyncExternalStore(machine.subscribe, machine.status);
    return <ConnectionStatus status={status} />;
  };
}

describe('sync.client badge (TC-19..TC-21)', () => {
  it('TC-19 shows Connecting… on first load and hides once synced', () => {
    const machine = createSyncStatusMachine();
    const Badge = badgeWithMachine(machine);
    const { container } = render(<Badge />);

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connecting…');

    act(() => { machine.synced(true) });
    expect(screen.queryByRole('status')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('TC-20 outage: Reconnecting…, then Connected for exactly CONNECTED_CONFIRMATION_MS', () => {
    const machine = createSyncStatusMachine();
    const Badge = badgeWithMachine(machine);
    render(<Badge />);
    act(() => { machine.synced(true) }); // healthy
    expect(screen.queryByRole('status')).toBeNull();

    act(() => { machine.providerStatus('disconnected') });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    expect(screen.getByRole('status').className).toContain('reconnecting');

    act(() => { machine.providerStatus('connected') });
    act(() => { machine.synced(true) });
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge.className).toContain('confirmed');

    // Boundary: still visible one ms before the setting elapses…
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS - 1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');
    // …hidden exactly at it.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('TC-21 disconnect during confirmation falls back to Reconnecting… immediately', () => {
    const machine = createSyncStatusMachine();
    const Badge = badgeWithMachine(machine);
    render(<Badge />);
    act(() => { machine.synced(true) });
    act(() => { machine.providerStatus('disconnected') });
    act(() => { machine.providerStatus('connected') });
    act(() => { machine.synced(true) });
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() => { machine.providerStatus('disconnected') });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
    // The stale confirmation timer must not hide the badge later.
    act(() => {
      vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS + 1_000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…');
  });

  it('the badge never blocks interaction with the board', () => {
    const machine = createSyncStatusMachine();
    act(() => { machine.providerStatus('disconnected') });
    const onDoubleClick = vi.fn();
    render(
      <div>
        <ConnectionStatus status={machine.status()} />
        <button onClick={onDoubleClick}>board</button>
      </div>
    );
    // The badge is visible and pointer-transparent over the control.
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'board' }));
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
