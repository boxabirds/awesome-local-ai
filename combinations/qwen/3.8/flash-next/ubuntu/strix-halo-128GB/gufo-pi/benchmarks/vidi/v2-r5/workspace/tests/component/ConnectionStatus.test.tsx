import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

describe('ConnectionStatus badge', () => {
  it('TC-19: shows "Connecting…" when state is connecting', () => {
    render(<ConnectionStatus state="connecting" />);
    const el = screen.getByTestId('connection-status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('Connecting…');
    expect(el).toHaveAttribute('role', 'status');
  });

  it('TC-20: shows "Reconnecting…" when state is reconnecting', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const el = screen.getByTestId('connection-status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('Reconnecting…');
    expect(el.className).toContain('connection-status--reconnecting');
  });

  it('TC-21: shows "Connected" when state is confirmed', () => {
    render(<ConnectionStatus state="confirmed" />);
    const el = screen.getByTestId('connection-status');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent('Connected');
    expect(el.className).toContain('connection-status--confirmed');
  });

  it('renders nothing when state is connected', () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.innerHTML).toBe('');
  });
});
