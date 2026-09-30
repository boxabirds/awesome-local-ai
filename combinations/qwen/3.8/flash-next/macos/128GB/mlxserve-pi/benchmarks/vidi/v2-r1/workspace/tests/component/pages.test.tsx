/**
 * The three pages' state machines (share.pages), with `api.ts` mocked: every
 * page state is forced on purpose and what the screen shows for it is asserted.
 * The pages are under test, not the network, so the API is a stand-in the test
 * tells what to answer (design: Mock vs real).
 *
 * Spec: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
 * section "Home, board and not-found pages" (TC-16, TC-17, TC-19, TC-20, TC-21).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { App } from '../../src/client/App';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { createBoardRequest, checkBoard } from '../../src/client/api';
import { UNREACHABLE_COPY } from '../../src/client/pages/state';
import { FakeWebsocketProvider } from './helpers/fake-provider';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const createMock = vi.mocked(createBoardRequest);
const checkMock = vi.mocked(checkBoard);

/** Let every already-resolved promise reach its `.then`. */
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  createMock.mockReset();
  checkMock.mockReset();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const newBoardButton = (): HTMLButtonElement =>
  screen.getByTestId('new-board-button') as HTMLButtonElement;

describe('the home page creates a board (share.create)', () => {
  // TC-16
  it('shows Creating… and disabled, then opens the board it was given (TC-16)', async () => {
    const id = newBoardId();
    let resolveCreate: ((value: { kind: 'created'; id: string }) => void) | null = null;
    createMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(<HomePage />);
    fireEvent.click(newBoardButton());

    // While the create is in flight: the label changed and it cannot be pressed
    // twice into the same create.
    expect(newBoardButton().textContent).toBe('Creating…');
    expect(newBoardButton().disabled).toBe(true);
    // Nothing has been added to the address bar yet.
    expect(window.location.pathname).toBe('/');

    await act(async () => {
      resolveCreate?.({ kind: 'created', id });
      await Promise.resolve();
    });
    expect(window.location.pathname).toBe(`/b/${id}`);
  });

  // TC-17: the same page state for the two ways a create can fail (a service
  // 500 and a network error both reach the page as `failed`).
  it.each([['500 create_failed'], ['network error']])(
    'stays home and explains the failure (%s) (TC-17)',
    async () => {
      createMock.mockResolvedValue({ kind: 'failed' });

      render(<HomePage />);
      fireEvent.click(newBoardButton());
      await flush();

      expect(screen.getByTestId('create-error').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
      // The button is available again, and nobody was moved off home.
      expect(newBoardButton().disabled).toBe(false);
      expect(window.location.pathname).toBe('/');

      // Pressing again creates a new attempt, and can fail again the same way.
      fireEvent.click(newBoardButton());
      await flush();
      expect(screen.getByTestId('create-error').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
      expect(newBoardButton().disabled).toBe(false);
      expect(window.location.pathname).toBe('/');
    },
  );
});

describe('a board link that cannot be opened (share.not_found)', () => {
  // TC-19 (negative): a malformed code is answered without a request.
  it('shows Board not found for a malformed id and asks the service nothing (TC-19)', async () => {
    window.history.replaceState(null, '', '/b/bad');

    render(<App />);
    await flush();

    expect(screen.getByTestId('not-found-heading').textContent).toBe('Board not found');
    expect(checkMock).not.toHaveBeenCalled();
  });

  // TC-20: a real-looking code the service says is not there.
  it('says Opening board… then Board not found, offering New board (TC-20)', async () => {
    const id = newBoardId();
    checkMock.mockResolvedValue({ kind: 'not_found' });

    render(<BoardPage id={id} />);

    // The check is in flight: the loading copy is up.
    expect(screen.getByTestId('board-checking').textContent).toBe('Opening board…');

    await flush();

    expect(screen.getByTestId('not-found-heading').textContent).toBe('Board not found');
    // It offers the way back in: a New board button, which creates nothing here.
    expect(screen.getByTestId('new-board-button')).not.toBeNull();
  });
});

describe('the service cannot be reached while opening (share.unreachable)', () => {
  // TC-21: unreachable twice, then it comes back — the page retries on its own
  // with a doubling wait and opens the board without a reload.
  it('reaches the board after two unreachable answers and the right waits (TC-21)', async () => {
    const id = newBoardId();
    checkMock
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id={id} />);
    await flush();
    expect(screen.getByTestId('board-unreachable').textContent).toBe(UNREACHABLE_COPY);

    // First wait: the base. A second unreachable answer arrives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS);
    });
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('board-unreachable').textContent).toBe(UNREACHABLE_COPY);

    // Second wait: double the base. The service is back; the board opens.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(checkMock).toHaveBeenCalledTimes(3);
    // The board is on screen without a reload: the stories 1–4 UI mounted.
    expect(screen.getByTestId('board-viewport')).not.toBeNull();
  });
});
