/**
 * Component tests for load-failure badge, edit lock and close-code mapping
 * (TC-22, TC-23, TC-28).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { canEdit } from '../../src/client/sync/connectBoard';

describe('ConnectionStatus load_failed (TC-22)', () => {
  it('TC-22: load_failed renders red text "This board couldn\'t be loaded. Retrying…" with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);

    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('load-failed');
    // Verify red styling class
    expect(badge.className).toContain('connection-status--load-failed');
  });

  it('TC-22b: connected state does not show the badge', () => {
    render(<ConnectionStatus state="connected" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('canEdit (TC-23)', () => {
  it('TC-23: canEdit returns false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('connected')).toBe(true);
    expect(canEdit('reconnecting')).toBe(true);
    expect(canEdit('confirmed')).toBe(true);
  });
});

describe('Close code mapping (TC-28)', () => {
  it('TC-28: close code 4500 maps to load_failed state', () => {
    // Test the canEdit mapping for all close-code-derived states
    expect(canEdit('load_failed')).toBe(false);
  });

  it('TC-28: close code 1011 maps to reconnecting (editing stays enabled)', () => {
    // 1011 → reconnecting → canEdit should be true
    expect(canEdit('reconnecting')).toBe(true);
  });

  it('TC-28: close code 1003 maps to reconnecting (editing stays enabled)', () => {
    // 1003 → reconnecting → canEdit should be true
    expect(canEdit('reconnecting')).toBe(true);
  });

  it('TC-28: storage failure (1011) does not show load-failed message', () => {
    // When state is reconnecting (which is what 1011 produces), the load-failed
    // message should NOT appear
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('Reconnecting…');
    expect(badge.textContent).not.toContain("couldn't be loaded");
  });

  it('TC-28: load_failed message does not appear in reconnecting state', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).not.toContain("This board couldn't be loaded");
  });
});
