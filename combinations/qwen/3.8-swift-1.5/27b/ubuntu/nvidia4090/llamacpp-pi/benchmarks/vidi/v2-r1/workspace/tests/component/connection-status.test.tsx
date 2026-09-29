import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';

describe('TC-19: connection badge', () => {
  it('connected state renders nothing', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
  });

  it('connecting state shows "Connecting…" badge', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByRole('status', { name: 'Connecting' });
    expect(badge).toHaveTextContent('Connecting…');
  });

  it('reconnecting state shows "Reconnecting…" badge', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByRole('status', { name: 'Reconnecting' });
    expect(badge).toHaveTextContent('Reconnecting…');
  });

  it('confirmed state shows "Connected" badge', () => {
    render(<ConnectionStatus state="confirmed" />);
    const badge = screen.getByRole('status', { name: 'Connected' });
    expect(badge).toHaveTextContent('Connected');
  });
});

describe('TC-22: load-failure badge', () => {
  it('load_failed state shows red "This board couldn\'t be loaded. Retrying…" with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status', { name: 'Board load failed' });
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    // Verify it's red
    expect(badge.style.background).toBe('rgb(244, 67, 54)');
  });
});
