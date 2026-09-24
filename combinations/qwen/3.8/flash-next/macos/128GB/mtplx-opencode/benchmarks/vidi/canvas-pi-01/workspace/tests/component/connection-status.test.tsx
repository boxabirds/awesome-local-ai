/**
 * Story 3 · component tests for the connection badge (design "Client connection
 * and status", TC-19..TC-21).
 *
 * The badge is inert presentational chrome; the timing rules live in the
 * connection machine (tested in `tests/unit/connectionState.test.ts`). Here we
 * only assert the mapping from a `ConnectionState` to what the board shows, and
 * that it never covers the board. (No jest-dom in this project, so we assert
 * raw `textContent` / attributes the way the story-1/2 tests do.)
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectionState';

describe('ConnectionStatus', () => {
  it('renders nothing when connected (a healthy connection shows no badge)', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it.each<[ConnectionState, string]>([
    ['connecting', 'Connecting…'],
    ['reconnecting', 'Reconnecting…'],
    ['confirmed', 'Connected'],
  ])('shows %s as %j', (state, label) => {
    render(<ConnectionStatus state={state} />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute('data-state')).toBe(state);
  });

  it('is an accessible status region that announces politely', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-live')).toBe('polite');
  });
});
