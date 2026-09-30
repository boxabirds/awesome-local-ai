// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';

afterEach(() => {
  cleanup();
});

describe('TC-19: ConnectionStatus badge — connecting', () => {
  it('shows "Connecting…" text and "status-connecting" class', () => {
    render(<ConnectionStatus state="connecting" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveClass('status-connecting');
  });
});

describe('TC-20: ConnectionStatus badge — connected and degraded', () => {
  it('shows "Connected" text and "status-connected" class', () => {
    render(<ConnectionStatus state="connected" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge).toHaveClass('status-connected');
  });

  it('shows "Reconnecting…" text and "status-degraded" class', () => {
    render(<ConnectionStatus state="reconnecting" />);
    const badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Reconnecting…');
    expect(badge).toHaveClass('status-degraded');
  });
});

describe('TC-21: ConnectionStatus badge — updates on state change', () => {
  it('updates DOM when state changes from connecting to connected', () => {
    const { rerender } = render(<ConnectionStatus state="connecting" />);
    let badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connecting…');
    expect(badge).toHaveClass('status-connecting');

    act(() => {
      rerender(<ConnectionStatus state="connected" />);
    });

    badge = screen.getByTestId('connection-status');
    expect(badge).toHaveTextContent('Connected');
    expect(badge).toHaveClass('status-connected');
  });
});
