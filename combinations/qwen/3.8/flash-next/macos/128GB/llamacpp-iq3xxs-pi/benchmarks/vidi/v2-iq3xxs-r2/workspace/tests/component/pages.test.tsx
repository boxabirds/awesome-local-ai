import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import {
  CREATE_FAILED_MESSAGE,
  CREATING_LABEL,
  NEW_BOARD_LABEL,
  TAGLINE,
} from '../../src/client/pages/HomePage';
import { NOT_FOUND_HEADING, NOT_FOUND_TEXT } from '../../src/client/pages/NotFoundPage';
import { OPENING_BOARD, UNREACHABLE_MESSAGE } from '../../src/client/pages/state';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import {
  apiCalls,
  currentCreatedBoardId,
  hangCreate,
  stubBoardNotFound,
  stubChecks,
  stubCreateFailed,
  stubCreateUnreachable,
} from './fixtures/api';
import { flushFrames } from './fixtures/board';

/**
 * The pages of story 5 (`share.pages`): Home with New board, and a board link going from
 * "Opening board…" to a board, to Board not found, or to a retry that keeps going until
 * the service answers.
 *
 * The board API is stubbed at `fetch` (`fixtures/api`) rather than by replacing
 * `src/client/api.ts`, so the status-code-to-page-outcome mapping the pages depend on is
 * exercised here too, and every request the pages make is on the record — which is how
 * TC-19 can be a negative test at all.
 */

/** Put the app at an address, as if the person had typed it or clicked a link. */
function renderAt(path: string): void {
  window.history.replaceState(null, '', path);
  render(<App />);
}

/** The existence checks the app has sent, oldest first. */
function checkCalls(): string[] {
  return apiCalls().filter((call) => call.startsWith('GET '));
}

/** Move the clock, and let whatever the clock caused reach the screen. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Let the promise a click started settle and React re-render, without touching timers. */
async function settlePromise(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the home page (TC-16, TC-17)', () => {
  it('TC-16 New board reads Creating… and then opens the board it made', async () => {
    renderAt('/');
    expect(screen.getByTestId('home')).toBeTruthy();
    expect(screen.getByText(TAGLINE)).toBeTruthy();

    const gate = hangCreate();
    const button = screen.getByTestId('new-board') as HTMLButtonElement;
    fireEvent.click(button);

    // The press is answered immediately, and there is no pressing it twice.
    expect(button.textContent).toBe(CREATING_LABEL);
    expect(button.disabled).toBe(true);
    // Nothing has been created at this address, because nothing has been asked yet.
    expect(window.location.pathname).toBe('/');

    gate.release();
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${currentCreatedBoardId()}`));
    // The new board is a board: the story 1 viewport is there, and it is empty.
    await waitFor(() => expect(document.querySelector('[data-testid="viewport"]')).not.toBeNull());
    // Making a board and opening it are two requests, and the second one is the same
    // existence check any other visitor makes: the app does not treat "I just made this"
    // as evidence, which is what keeps `share.bad_link` honest for the person who made a
    // board that got deleted.
    expect(apiCalls()).toEqual(['POST /api/boards', `GET /api/boards/${currentCreatedBoardId()}`]);
  });

  const createFailures = [
    { name: 'the service answers 500', stub: () => stubCreateFailed(500) },
    { name: 'the service cannot be reached', stub: () => stubCreateUnreachable() },
  ] as const;

  for (const { name, stub } of createFailures) {
    it(`TC-17 when ${name}, the home page says so, the button works again and Home stays Home`, async () => {
      stub();
      renderAt('/');
      fireEvent.click(screen.getByTestId('new-board'));
      await settlePromise();

      expect(screen.getByRole('alert').textContent).toBe(CREATE_FAILED_MESSAGE);
      const button = screen.getByTestId('new-board') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe(NEW_BOARD_LABEL);
      // `share.create_failure`: the person is kept on the home page.
      expect(window.location.pathname).toBe('/');
      expect(screen.getByTestId('home')).toBeTruthy();
      // And of course nothing was created, at this address or any other.
      expect(checkCalls()).toEqual([]);

      // The button really is available again: pressing it asks once more.
      fireEvent.click(button);
      await settlePromise();
      expect(apiCalls()).toHaveLength(2);
    });
  }
});

describe('a board link (TC-19, TC-20, TC-21)', () => {
  it('TC-19 a malformed board address is Board not found, and no check is ever sent', async () => {
    renderAt('/b/bad');
    await waitFor(() => expect(screen.getByText(NOT_FOUND_HEADING)).toBeTruthy());
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeTruthy();
    // The way out of a bad link is a good board.
    expect(screen.getByTestId('new-board')).toBeTruthy();

    // The negative half: an id that cannot be a board never becomes a request.
    await flushFrames();
    expect(apiCalls()).toEqual([]);
  });

  it('TC-20 a valid id nobody created says Opening board… and then Board not found', async () => {
    stubBoardNotFound();
    const boardId = newBoardId();
    renderAt(`/b/${boardId}`);

    // The first thing the page can honestly say, before anything has come back.
    expect(screen.getByTestId('board-status').textContent).toBe(OPENING_BOARD);

    await waitFor(() => expect(screen.getByText(NOT_FOUND_HEADING)).toBeTruthy());
    expect(screen.getByTestId('new-board')).toBeTruthy();
    expect(checkCalls()).toEqual([`GET /api/boards/${boardId}`]);
    // A mistyped link is not a board, and the app made sure of that: no board, no socket.
    expect(document.querySelector('[data-testid="viewport"]')).toBeNull();
  });

  it('TC-21 a service that cannot be reached is retried with backoff, and the board opens without a reload', async () => {
    vi.useFakeTimers();
    try {
      stubChecks('unreachable', 'unreachable', 'exists');
      const boardId = newBoardId();
      renderAt(`/b/${boardId}`);

      await settlePromise();
      expect(screen.getByTestId('board-status').textContent).toBe(UNREACHABLE_MESSAGE);
      expect(checkCalls()).toHaveLength(1);
      // The board is not shown, and nothing has been decided about it either.
      expect(document.querySelector('[data-testid="viewport"]')).toBeNull();
      expect(screen.queryByText(NOT_FOUND_HEADING)).toBeNull();

      // Retry one: only after BOARD_CHECK_RETRY_BASE_MS, and not a millisecond sooner.
      await advance(BOARD_CHECK_RETRY_BASE_MS - 1);
      expect(checkCalls()).toHaveLength(1);
      await advance(1);
      expect(checkCalls()).toHaveLength(2);
      // Still the same message: a retry that kept changing the sentence would say the
      // situation had changed when it has not.
      expect(screen.getByTestId('board-status').textContent).toBe(UNREACHABLE_MESSAGE);

      // Retry two: doubled, up to story 3's reconnect cap.
      await advance(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
      expect(checkCalls()).toHaveLength(2);
      await advance(1);
      expect(checkCalls()).toHaveLength(3);

      // The third ask reached the service, and the board opens — nobody reloaded anything.
      await settlePromise();
      expect(document.querySelector('[data-testid="viewport"]')).not.toBeNull();
      expect(screen.queryByTestId('board-status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
