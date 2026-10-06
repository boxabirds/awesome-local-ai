/**
 * TC-19, TC-20, TC-21: arriving at a link, and what has to be true before a board is on screen.
 *
 * These three cases are the story. A link is a claim about a board, and the page's job is to act on
 * that claim only as far as the service has actually supported it:
 *
 *   TC-19 — an address that is not a link gets no request at all. The service is not asked whether
 *           "bad" is a board, because "bad" is not a board id and asking is how a site ends up with
 *           a board for every typo in every chat window.
 *   TC-20 — an address that is a link, to a board that is not there: first the waiting sentence,
 *           then Board not found, and never an empty canvas. This is the failure the PRD was
 *           written about.
 *   TC-21 — an address the service could not be asked about: the page says it could not reach
 *           vidi6, asks again, and asks again, and opens the board as soon as it can — without a
 *           reload, and without ever concluding that a board is gone because something else was
 *           down for two seconds.
 *
 * The board itself is replaced by a stand-in, because these tests are about the page that decides
 * whether to put a board on screen; the board's own behaviour has its own files. Everything else —
 * the router, the api module, the retry schedule, the clock — is the real thing.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import {
  CREATE_FAILED_MESSAGE,
  NEW_BOARD_LABEL,
  NOT_FOUND_DETAIL,
  NOT_FOUND_HEADING,
  OPENING_BOARD_MESSAGE,
  TAGLINE,
  UNREACHABLE_MESSAGE,
} from '../../src/client/pages/messages';
import { SHARE_LABEL } from '../../src/client/share/SharePanel';
import { boardCheckDelay } from '../../src/client/pages/BoardPage';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { stubFetch } from './helpers/fake-api';

// `React.createElement` rather than JSX: the mock factory is hoisted above the imports, and the
// jsx runtime this file would otherwise lean on is not there yet when it runs.
vi.mock('../../src/client/board/Board', async () => {
  const { createElement } = await import('react');
  return {
    Board: ({ boardId }: { boardId: string }) =>
      createElement('div', { 'data-testid': 'board-stand-in', 'data-board-id': boardId }),
  };
});

/** A board id with nothing wrong with it, for the cases that need one. */
const BOARD_ID = newBoardId();

/** The wait the page is allowed to make before it asks a second time. */
const FIRST_RETRY_MS = BOARD_CHECK_RETRY_BASE_MS;
/** …and before it asks a third time, which is twice as long. */
const SECOND_RETRY_MS = 2 * BOARD_CHECK_RETRY_BASE_MS;

/** Lets whatever the page started land, however many promise hops it takes. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
  });
}

/** Steps the fake clock and lets the page react to it. */
async function passTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Which page is on screen, by the one marker each of them has. */
function pageOnScreen(): string {
  for (const testid of [
    'home-page',
    'board-page',
    'board-opening',
    'board-unreachable',
    'not-found',
  ]) {
    if (screen.queryByTestId(testid)) return testid;
  }
  return '(nothing recognisable)';
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('an address that is not a board link (TC-19)', () => {
  it('is answered without asking the service anything', async () => {
    window.history.replaceState({}, '', '/b/bad');
    const api = stubFetch();

    render(<App />);

    expect(screen.getByTestId('not-found-heading').textContent).toBe(NOT_FOUND_HEADING);
    expect(api.calls).toEqual([]);
    await settle();
    // Still no request, after everything the page had time to start.
    expect(api.calls).toEqual([]);
    api.restore();
  });

  it('shows the link that was asked for, so it can be compared with the one that was sent', () => {
    window.history.replaceState({}, '', '/b/short');
    const api = stubFetch();

    render(<App />);

    expect(screen.getByTestId('not-found-board-id').textContent).toBe('short');
    expect(api.calls).toEqual([]);
    api.restore();
  });

  it('is the same answer as an address from somewhere else entirely', () => {
    window.history.replaceState({}, '', '/pricing');
    const api = stubFetch();

    render(<App />);

    expect(pageOnScreen()).toBe('not-found');
    // Not a board, so there is no board to name: the page says what is wrong without inventing one.
    expect(screen.queryByTestId('not-found-board-id')).toBeNull();
    expect(api.calls).toEqual([]);
    api.restore();
  });

  it('keeps the shape of the page a person needs: an explanation, and a way out', () => {
    window.history.replaceState({}, '', '/b/bad');
    const api = stubFetch();

    render(<App />);

    expect(screen.getByText(NOT_FOUND_DETAIL)).toBeTruthy();
    expect(screen.getByTestId('new-board-button').textContent).toBe(NEW_BOARD_LABEL);
    expect(screen.getByTestId('home-link').getAttribute('href')).toBe('/');
    api.restore();
  });
});

describe('a link to a board that is not there (TC-20)', () => {
  it('waits in words, then says there is no board, once the service has said so', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch({ status: 404, json: { error: 'not_found' } });

    render(<App />);

    // The waiting sentence, before the answer has had anywhere to be.
    expect(screen.getByTestId('board-opening').textContent).toBe(OPENING_BOARD_MESSAGE);
    expect(pageOnScreen()).toBe('board-opening');

    await settle();

    expect(pageOnScreen()).toBe('not-found');
    expect(screen.getByTestId('not-found-heading').textContent).toBe(NOT_FOUND_HEADING);
    expect(screen.getByTestId('not-found-board-id').textContent).toBe(BOARD_ID);
    expect(api.calls).toHaveLength(1);
    expect(api.path(0)).toBe(`/api/boards/${BOARD_ID}`);
    api.restore();
  });

  it('does not keep asking about a board the service has already said is not there', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch(
      { status: 404, json: { error: 'not_found' } },
      new Error('a page that keeps asking would get this'),
    );

    render(<App />);
    await settle();
    await passTime(FIRST_RETRY_MS);
    await passTime(SECOND_RETRY_MS);
    await passTime(60_000);

    expect(api.calls).toHaveLength(1);
    expect(pageOnScreen()).toBe('not-found');
    api.restore();
  });

  it('offers a new board, and takes the person to it when they ask for one', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const other = newBoardId();
    // The answer about this link, then the answer to "give me a board", then this test is done:
    // nothing else gets to make a request.
    const api = stubFetch(
      { status: 404, json: { error: 'not_found' } },
      { status: 201, json: { id: other } },
      { status: 404, json: { error: 'not_found' } },
    );

    render(<App />);
    await settle();

    // Nothing was created by arriving: the only way a board appears here is the button.
    expect(api.calls.map((call) => call.method)).toEqual(['GET']);

    fireEvent.click(screen.getByTestId('new-board-button'));
    await settle();

    expect(api.calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
    expect(window.location.pathname).toBe(`/b/${other}`);
    api.restore();
  });

  it('says what a failed new board means here too', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch(
      { status: 404, json: { error: 'not_found' } },
      { status: 500, json: { error: 'create_failed' } },
    );

    render(<App />);
    await settle();
    fireEvent.click(screen.getByTestId('new-board-button'));
    await settle();

    expect(screen.getByTestId('not-found-error').textContent).toBe(CREATE_FAILED_MESSAGE);
    // Still on the page that explains the dead link: nowhere else to be.
    expect(pageOnScreen()).toBe('not-found');
    expect(window.location.pathname).toBe(`/b/${BOARD_ID}`);
    api.restore();
  });
});

describe('a link the service could not be asked about (TC-21)', () => {
  it('says it cannot reach vidi6, and then opens the board when it can', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), {
      json: { id: BOARD_ID },
    });

    render(<App />);
    await settle();

    expect(screen.getByTestId('board-unreachable').textContent).toContain(UNREACHABLE_MESSAGE);
    expect(api.calls).toHaveLength(1);

    // The first wait, and the second question.
    await passTime(FIRST_RETRY_MS);
    await settle();
    expect(api.calls).toHaveLength(2);
    expect(pageOnScreen()).toBe('board-unreachable');

    // …which failed too, so the page waits twice as long. That the second wait is longer is what
    // "retrying" is supposed to mean: it is a schedule, not a hang-up.
    await passTime(FIRST_RETRY_MS);
    await settle();
    expect(api.calls).toHaveLength(2);
    await passTime(SECOND_RETRY_MS - FIRST_RETRY_MS);
    await settle();
    expect(api.calls).toHaveLength(3);

    // And the board opens, in this same page, with the Share button on it and no reload in sight.
    expect(pageOnScreen()).toBe('board-page');
    expect(screen.getByTestId('board-stand-in').getAttribute('data-board-id')).toBe(BOARD_ID);
    expect(screen.getByTestId('share-button').textContent).toBe(SHARE_LABEL);
    expect(window.location.pathname).toBe(`/b/${BOARD_ID}`);
    api.restore();
  });

  it('treats a service that answers badly as one it cannot reach', async () => {
    // A 500 says nothing about whether this board exists, so it must not be read as "no".
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch({ status: 500, json: { error: 'boom' } }, { json: { id: BOARD_ID } });

    render(<App />);
    await settle();

    expect(pageOnScreen()).toBe('board-unreachable');
    await passTime(FIRST_RETRY_MS);
    await settle();

    expect(pageOnScreen()).toBe('board-page');
    expect(api.calls).toHaveLength(2);
    api.restore();
  });

  it('treats an answer that is not about this board as one it cannot reach', async () => {
    // A 200 naming some other board is not evidence about this one.
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch({ json: { id: newBoardId() } }, { json: { id: BOARD_ID } });

    render(<App />);
    await settle();

    expect(pageOnScreen()).toBe('board-unreachable');
    await passTime(FIRST_RETRY_MS);
    await settle();
    expect(pageOnScreen()).toBe('board-page');
    api.restore();
  });

  it('goes on waiting rather than saying there is no board, however long the service is silent', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    // Five questions that get nothing, in a row. A page that mistook one silence for an answer
    // would have said "Board not found" somewhere in here.
    const api = stubFetch(...Array.from({ length: 5 }, () => new TypeError('Failed to fetch')), {
      json: { id: BOARD_ID },
    });

    render(<App />);
    await settle();

    for (const wait of [1000, 2000, 4000, 8000, 10_000]) {
      await passTime(wait);
      await settle();
      expect(screen.queryByTestId('not-found')).toBeNull();
    }

    expect(pageOnScreen()).toBe('board-page');
    expect(api.calls).toHaveLength(6);
    api.restore();
  });

  it('waits on a schedule that grows, and stops growing before it is silly', () => {
    // The schedule the page above is timed against, written down once so that "retrying" means
    // the same thing in the message, in the code and in this test.
    expect(boardCheckDelay(0)).toBe(BOARD_CHECK_RETRY_BASE_MS);
    expect(boardCheckDelay(1)).toBe(2 * BOARD_CHECK_RETRY_BASE_MS);
    expect(boardCheckDelay(2)).toBe(4 * BOARD_CHECK_RETRY_BASE_MS);
    expect(boardCheckDelay(3)).toBe(8 * BOARD_CHECK_RETRY_BASE_MS);
    // It never waits longer than the connection is willing to wait for a room, and it never gets
    // shorter: a person who leaves the tab open through an outage stops being told about it every
    // second, but is not forgotten about either.
    expect(boardCheckDelay(4)).toBe(RECONNECT_MAX_BACKOFF_MS);
    expect(boardCheckDelay(40)).toBe(RECONNECT_MAX_BACKOFF_MS);
  });

  it('asks about the link it was given, once, when there is nothing wrong with reaching vidi6', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch({ json: { id: BOARD_ID } });

    render(<App />);
    await settle();

    expect(pageOnScreen()).toBe('board-page');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('GET');
    api.restore();
  });

  it('is not the home page any more, and that is the difference this story makes', async () => {
    window.history.replaceState({}, '', `/b/${BOARD_ID}`);
    const api = stubFetch({ json: { id: BOARD_ID } });

    render(<App />);
    await settle();

    expect(screen.queryByText(TAGLINE)).toBeNull();
    expect(screen.queryByTestId('home-page')).toBeNull();
    api.restore();
  });
});
