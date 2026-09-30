import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { model, noteElements, renderApp } from './helpers';

// Captures the App's connection so each state can be driven directly.
const connections: { boardId: string; onState(s: ConnectionState): void; destroy: ReturnType<typeof vi.fn> }[] = [];
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, boardId: string, onState: (s: ConnectionState) => void) => {
    const conn = { boardId, onState, destroy: vi.fn() };
    connections.push(conn);
    onState('connecting');
    return conn;
  },
}));

function current() {
  return connections[connections.length - 1];
}

describe('App live board wiring (sync.client)', () => {
  beforeEach(() => {
    connections.length = 0;
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('redirects / to /b/<new board id> and connects to that board', () => {
    renderApp();
    const match = /^\/b\/(.+)$/.exec(window.location.pathname);
    expect(match?.[1]).toMatch(BOARD_ID_PATTERN);
    expect(current().boardId).toBe(match?.[1]);
  });

  it('opens the board named in /b/:boardId', () => {
    const id = 'AbCdEfGhIjKlMnOpQr_-09';
    window.history.replaceState(null, '', `/b/${id}`);
    renderApp();
    expect(window.location.pathname).toBe(`/b/${id}`);
    expect(current().boardId).toBe(id);
  });

  it('the board stays editable in every connection state (no lockout)', () => {
    renderApp();
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'connected'];
    const expected = { connecting: 'Connecting…', reconnecting: 'Reconnecting…', confirmed: 'Connected' } as const;
    states.forEach((state, i) => {
      act(() => current().onState(state));
      const badge = document.querySelector('.connection-status');
      if (state === 'connected') expect(badge).toBeNull();
      else expect(badge).toHaveTextContent(expected[state as keyof typeof expected]);
      act(() => screen.getByRole('button', { name: 'Sticky note' }).click());
      expect(noteElements()).toHaveLength(i + 1);
    });
    model((doc) => createSticky(doc, { x: 500, y: 500 }));
    expect(noteElements()).toHaveLength(states.length + 1);
  });
});
