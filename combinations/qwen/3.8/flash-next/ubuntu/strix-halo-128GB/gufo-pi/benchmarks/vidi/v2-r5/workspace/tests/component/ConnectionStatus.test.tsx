import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { canEdit, type ConnectionState } from '../../src/client/sync/connectBoard';

describe('TC-22: ConnectionStatus renders correct text and colour per state', () => {
  it("'connecting' renders 'Connecting…'", () => {
    render(<ConnectionStatus state="connecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
  });

  it("'connected' renders nothing (hidden)", () => {
    const { container } = render(<ConnectionStatus state="connected" />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("'reconnecting' renders 'Reconnecting…' with amber class", () => {
    render(<ConnectionStatus state="reconnecting" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Reconnecting…');
    expect(el.className).toContain('reconnecting');
  });

  it("'confirmed' renders 'Connected' with green class", () => {
    render(<ConnectionStatus state="confirmed" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Connected');
    expect(el.className).toContain('confirmed');
  });

  it("'load_failed' renders 'This board couldn't be loaded. Retrying…' with red class", () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(el.className).toContain('load_failed');
  });
});

describe('TC-23: canEdit returns false only for load_failed', () => {
  const editableStates: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed'];

  for (const state of editableStates) {
    it(`canEdit('${state}') is true`, () => {
      expect(canEdit(state)).toBe(true);
    });
  }

  it("canEdit('load_failed') is false", () => {
    expect(canEdit('load_failed')).toBe(false);
  });

  it('canEdit(undefined) is true (backward compatible)', () => {
    expect(canEdit(undefined)).toBe(true);
  });
});
