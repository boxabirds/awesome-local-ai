/**
 * Pages (story 5, task 4): TC-16, TC-17, TC-19, TC-20, TC-21.
 *
 * Component level, with the board API mocked, so the state machines are driven
 * directly: creation succeeds and fails, a board is unknown, and a service that
 * cannot be reached is retried on a timer. The board itself is rendered behind a
 * fake WebSocket provider so a ready state renders the real board chrome.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkBoard, createBoardRequest } from '../../src/client/api';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { CREATE_FAILED_MESSAGE } from '../../src/client/pages/state';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// A provider that never touches the network: enough surface for connectBoard and
// useBoardDoc to mount the board in the ready state. Self-contained (defined
// inside the factory) so the hoisted mock has nothing to reference early.
vi.mock('y-websocket', () => {
  class FakeProvider {
    doc: unknown;
    awareness: Record<string, unknown>;
    wsconnected = false;
    ws: unknown = null;
    status = 'disconnected';
    destroyed = false;
    private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    constructor(_serverURL: string, _roomname: string, opts?: { doc?: unknown }) {
      this.doc = opts?.doc;
      this.awareness = {
        states: new Map(),
        setLocalState: () => {},
        setLocalStateField: () => {},
        getStates: () => new Map(),
        getClientID: () => 1,
        on: () => {},
        off: () => {},
        removeAwarenessState: () => {},
        destroy: () => {},
      };
    }
    addHandler(name: string, cb: (...args: unknown[]) => void): void {
      (this.handlers[name] ??= []).push(cb);
    }
    on(name: string, cb: (...args: unknown[]) => void): void {
      (this.handlers[name] ??= []).push(cb);
    }
    off(): void {}
    removeHandler(): void {}
    emit(name: string): void {
      for (const cb of this.handlers[name] ?? []) cb(name === 'status' ? 'connected' : {}, this);
    }
    connect(): void {
      this.wsconnected = true;
      this.status = 'connected';
      this.emit('status');
    }
    disconnect(): void {
      this.wsconnected = false;
      this.status = 'disconnected';
      this.emit('status');
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { WebsocketProvider: FakeProvider };
});

const mockedCreate = vi.mocked(createBoardRequest);
const mockedCheck = vi.mocked(checkBoard);

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('Home page (TC-16, TC-17)', () => {
  it('creating moves to the new board address; the button reads Creating… while it works', async () => {
    let resolveCreate!: (v: { kind: 'created'; id: string }) => void;
    mockedCreate.mockReturnValue(new Promise((r) => (resolveCreate = r)));

    render(<HomePage />);
    const button = screen.getByTestId('new-board-button');
    await act(async () => {
      button.click();
    });

    // In flight: the button shows Creating… and is disabled.
    expect(button).toHaveTextContent('Creating…');
    expect(button).toBeDisabled();

    const id = newBoardId();
    await act(async () => {
      resolveCreate({ kind: 'created', id });
    });

    expect(window.location.pathname).toBe(`/b/${id}`);
  });

  it('a failed create shows the PRD message and re-enables the button', async () => {
    mockedCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const button = screen.getByTestId('new-board-button');
    await act(async () => {
      button.click();
    });

    expect(screen.getByTestId('home-error')).toHaveTextContent(CREATE_FAILED_MESSAGE);
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('New board');
  });
});

describe('Board page existence check (TC-19, TC-20, TC-21)', () => {
  it('a malformed id shows Board not found with no request at all (TC-19)', () => {
    render(<BoardPage id="abc" />);
    expect(mockedCheck).not.toHaveBeenCalled();
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });

  it('an unknown id goes from Opening board… to Board not found (TC-20)', async () => {
    mockedCheck.mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={newBoardId()} />);
    // While the first check is in flight, the page says Opening board….
    expect(screen.getByTestId('board-page-status')).toHaveTextContent('Opening board…');

    await screen.findByTestId('not-found-page');
    expect(mockedCheck).toHaveBeenCalledTimes(1);
  });

  it('an unreachable service retries on its own and opens the board (TC-21)', async () => {
    vi.useFakeTimers();
    mockedCheck
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValue({ kind: 'exists' });

    const id = newBoardId();
    render(<BoardPage id={id} />);

    // First check fires, then the retry timers (BASE, then 2×BASE).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('board-page-status')).toHaveTextContent('Retrying');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(mockedCheck).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });

    expect(mockedCheck).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board-page')).toBeInTheDocument();
  });
});
