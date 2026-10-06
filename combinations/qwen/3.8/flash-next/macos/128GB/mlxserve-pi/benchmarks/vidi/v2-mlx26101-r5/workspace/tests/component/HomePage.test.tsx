/**
 * TC-16, TC-17: the home page, and the button everything in this story starts from.
 *
 * What these assert is the order the words arrive in, not only their presence. "Creating…" while
 * the request is out there and the button disabled, because a person who clicks twice as fast as
 * the service answers should get one board and not two; the address still `/` until the service has
 * said `201`, because an address that names a board that does not exist is the exact thing this
 * story was written to make impossible; and on the way back, one sentence that says what happened
 * and leaves the way out open — with the button still working, because the way to try again is the
 * button.
 *
 * The service is stubbed at `fetch`, so both halves of the page — asking, and what the answer means
 * — are in what is being tested.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import App from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import {
  CREATE_FAILED_MESSAGE,
  CREATING_LABEL,
  NEW_BOARD_LABEL,
} from '../../src/client/pages/messages';
import { stubFetch } from './helpers/fake-api';

/** A board id, so the address the page ends up at is a string the test wrote down. */
const BOARD_ID = newBoardId();

/** The New board button, as the button it is. */
function newBoardButton(): HTMLButtonElement {
  return screen.getByTestId('new-board-button') as HTMLButtonElement;
}

/**
 * A promise somebody else holds the other end of, for a server that answers when the test says
 * rather than the instant the page asks — which is the only way to see what a page says while a
 * person is waiting.
 */
function deferred(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets the page finish whatever the click started. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Puts the tab at an address before the page reads it. */
function at(path: string): void {
  window.history.replaceState({}, '', path);
}

/** Which page is on screen, by the one marker each of them has. */
function pageOnScreen(): string {
  for (const testid of ['home-page', 'board-page', 'board-opening', 'not-found']) {
    if (screen.queryByTestId(testid)) return testid;
  }
  return '(nothing recognisable)';
}

afterEach(() => {
  at('/');
});

describe('a visitor arrives at the home page (TC-16)', () => {
  it('says what vidi6 is and offers one thing to do', () => {
    at('/');
    render(<App />);

    expect(pageOnScreen()).toBe('home-page');
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByTestId('new-board-button').textContent).toBe(NEW_BOARD_LABEL);
  });

  it('asks the service for a board, and only that', () => {
    at('/');
    const api = stubFetch({ json: { id: BOARD_ID } });
    render(<App />);

    fireEvent.click(screen.getByTestId('new-board-button'));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('POST');
    expect(api.path(0)).toBe('/api/boards');
  });

  it('shows the click is doing something, and writes nothing into the address bar yet', async () => {
    at('/');
    // The answer is held back: this is the half-second a person spends waiting, and the only
    // moment at which "Creating…" and a live button can both be true.
    const gate = deferred();
    const api = stubFetch(gate.promise);
    const view = render(<App />);

    fireEvent.click(screen.getByTestId('new-board-button'));

    const button = newBoardButton();
    expect(button.textContent).toBe(CREATING_LABEL);
    expect(button.disabled).toBe(true);
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('home-error').textContent).toBe('');

    // A second click while the first is still out there is not a second board.
    fireEvent.click(button);
    expect(api.calls).toHaveLength(1);

    gate.resolve(
      new Response(JSON.stringify({ id: BOARD_ID }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await settle();

    expect(window.location.pathname).toBe(`/b/${BOARD_ID}`);
    view.unmount();
    api.restore();
  });

  it('ends up on the board the service named', async () => {
    at('/');
    const api = stubFetch({ json: { id: BOARD_ID } });
    const view = render(<App />);

    fireEvent.click(screen.getByTestId('new-board-button'));
    await settle();

    // The board page, at the board's address — and it is the same id, not one the page made up.
    expect(window.location.pathname).toBe(`/b/${BOARD_ID}`);
    expect(api.calls[1]).toBeTruthy();
    expect(api.path(1)).toBe(`/api/boards/${BOARD_ID}`);
    view.unmount();
    api.restore();
  });
});

describe('creating a board fails (TC-17)', () => {
  // Two ways the same thing happens, and the page must not need to know which: the service can
  // answer that it could not do it, or it can not answer at all.
  const failures: readonly { label: string; answer: Response | Error | { status: number } }[] = [
    { label: 'the service says it failed', answer: { status: 500 } },
    { label: 'the request never arrives', answer: new TypeError('Failed to fetch') },
  ];

  for (const { label, answer } of failures) {
    it(`says so, and leaves the way out working, when ${label}`, async () => {
      at('/');
      // The failure, then nothing else: if the page retries the creation on its own, the retry
      // throws and this test says so.
      const api = stubFetch(answer, answer, answer);
      const view = render(<App />);

      fireEvent.click(screen.getByTestId('new-board-button'));
      await settle();

      expect(screen.getByTestId('home-error').textContent).toBe(CREATE_FAILED_MESSAGE);
      // Still the home page: a failure is not a reason to move somebody somewhere else.
      expect(pageOnScreen()).toBe('home-page');
      expect(window.location.pathname).toBe('/');
      // The button is a button again, in its own words, because the next thing to do is press it.
      const button = newBoardButton();
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe(NEW_BOARD_LABEL);

      view.unmount();
      api.restore();
    });

    it(`says it once however many times it fails, when ${label}`, async () => {
      at('/');
      const api = stubFetch(answer, answer, answer, answer);
      const view = render(<App />);

      fireEvent.click(screen.getByTestId('new-board-button'));
      await settle();
      fireEvent.click(screen.getByTestId('new-board-button'));
      await settle();

      expect(screen.getAllByTestId('home-error')).toHaveLength(1);
      expect(screen.getByTestId('home-error').textContent).toBe(CREATE_FAILED_MESSAGE);
      expect(api.calls).toHaveLength(2);

      view.unmount();
      api.restore();
    });
  }
});
