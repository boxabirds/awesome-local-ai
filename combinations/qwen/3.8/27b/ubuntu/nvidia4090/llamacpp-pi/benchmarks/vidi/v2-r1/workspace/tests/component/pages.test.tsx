// TC-16, TC-17, TC-19–TC-21 (story 5): the Home, Board and Board not found
// pages, with the board API mocked (ui-component tests never hit a network)
// and the y-websocket provider stubbed so a ready board mounts offline.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { checkBoard, createBoardRequest } from '../../src/client/api';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { CREATE_FAILURE_MESSAGE } from '../../src/client/pages/state';

const hoisted = vi.hoisted(() => {
  class FakeProvider {
    wsconnected = false;
    on(): this {
      return this;
    }
    destroy() {}
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: hoisted.FakeProvider }));

const CREATED_ID = 'c'.repeat(22);
const BOARD_ID = 'b'.repeat(22);

beforeEach(() => {
  // The component setup mocks the api module with these same defaults; reset
  // and set them explicitly so each test starts from a known boundary.
  vi.mocked(checkBoard).mockReset().mockResolvedValue({ kind: 'exists' });
  vi.mocked(createBoardRequest)
    .mockReset()
    .mockResolvedValue({ kind: 'created', id: CREATED_ID });
});

describe('pages (share.pages)', () => {
  it('TC-16: New board on home → "Creating…" (disabled) → /b/<id> with the board open', async () => {
    window.history.pushState(null, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();

    // The created board opens (story 1 hint is the empty state).
    await screen.findByTestId('board-root');
    expect(window.location.pathname).toBe(`/b/${CREATED_ID}`);
    expect(createBoardRequest).toHaveBeenCalledTimes(1);
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-17: creation fails (RPC 500, then network error — 2 runs) → message, button enabled, still on /', async () => {
    window.history.pushState(null, '', '/');
    // Both failures arrive as kind: 'failed' at the api boundary.
    vi.mocked(createBoardRequest).mockReset().mockResolvedValue({ kind: 'failed' });
    render(<App />);

    // Run 1: RPC failure (500).
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CREATE_FAILURE_MESSAGE);
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();

    // Run 2: network error.
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CREATE_FAILURE_MESSAGE);
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();

    expect(window.location.pathname).toBe('/');
    expect(createBoardRequest).toHaveBeenCalledTimes(2);
  });

  it('TC-19: /b/bad → Board not found, and checkBoard is never called', async () => {
    window.history.pushState(null, '', '/b/bad');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(checkBoard).not.toHaveBeenCalled();
  });

  it('TC-20: well-formed id whose check 404s → "Opening board…" then Board not found with New board', async () => {
    vi.mocked(checkBoard).mockReset().mockResolvedValue({ kind: 'not_found' });
    window.history.pushState(null, '', `/b/${BOARD_ID}`);
    render(<App />);

    // The loading state is visible while the check is in flight.
    expect(screen.getByTestId('board-opening')).toHaveTextContent('Opening board…');

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-21: unreachable → retry message with doubling backoff → the board opens, 3 checks total', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(checkBoard)
        .mockReset()
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValueOnce({ kind: 'unreachable' })
        .mockResolvedValue({ kind: 'exists' });
      window.history.pushState(null, '', `/b/${BOARD_ID}`);
      render(<BoardPage id={BOARD_ID} />);
      expect(screen.getByTestId('board-opening')).toHaveTextContent('Opening board…');

      // Check 1 fails → the retry message; the next attempt comes after the base.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('board-unreachable')).toHaveTextContent(
        'Couldn\'t reach vidi6. Retrying…',
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
      });
      expect(screen.getByTestId('board-unreachable')).toBeInTheDocument();

      // Check 2 fails → the backoff doubles; check 3 succeeds → the board opens.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2 * BOARD_CHECK_RETRY_BASE_MS);
      });
      expect(screen.getByTestId('board-root')).toBeInTheDocument();
      expect(checkBoard).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
