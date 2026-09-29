/**
 * Connection badge component tests (`sync.badge_*`). The badge shows exactly one state
 * label at a time — a wrong-state label is asserted absent, never merely hidden.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/board/ConnectionStatus.js';

describe('ConnectionStatus badge (sync.badge)', () => {
  it('TC-19 shows "Connecting…" on a fresh mount and never "Connected"', () => {
    render(<ConnectionStatus status="connecting" />);
    const badge = document.querySelector('.test-connection-status');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Connecting…');
    expect(screen.queryByText('Connected')).toBeNull();
    expect(badge!.getAttribute('data-status')).toBe('connecting');
  });

  it('TC-20 shows offline plus an error message for an invalid board id', () => {
    render(<ConnectionStatus status="offline" message="This board link is not valid." />);
    const badge = document.querySelector('.test-connection-status');
    expect(badge!.getAttribute('data-status')).toBe('offline');
    expect(badge!.textContent).toContain('Offline');
    expect(screen.queryByText('This board link is not valid.')).not.toBeNull();
  });

  it('TC-21 shows "Connected" and no Offline / Connecting label', () => {
    render(<ConnectionStatus status="online" />);
    const badge = document.querySelector('.test-connection-status');
    expect(badge!.textContent).toContain('Connected');
    expect(screen.queryByText('Offline')).toBeNull();
    expect(screen.queryByText(/Connecting/)).toBeNull();
  });

  it('the connecting label never contains the connected word as a substring', () => {
    // Guards the getByText('Connected') e2e assertion against a 'Connecting…' false match.
    render(<ConnectionStatus status="connecting" />);
    expect(document.querySelector('.test-connection-status')!.textContent).not.toContain('Connected');
  });
});
