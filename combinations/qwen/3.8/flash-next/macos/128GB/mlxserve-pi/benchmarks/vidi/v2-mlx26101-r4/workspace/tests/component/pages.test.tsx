/**
 * Component tests for the three pages and the address that picks between them (share.pages).
 *
 * What is under test is a decision, not a layout: given an address and whatever the service had to
 * say about it, which of the four screens does a person get? The service is mocked here, because the
 * four answers it can give — made, not made, there, not there, and nothing at all — are the thing
 * being tested, and producing the fourth with a real server means stopping a server. The board behind
 * the answering is the app's own, mounted for real, so a test that says "the board opened" means the
 * board's controls are on the screen and not that a flag was set somewhere.
 *
 * Two of these tests are about the negative half of the story, and they are the reason the rest
 * exist. A board is created by the service and nowhere else, and a board is only ever *found* by
 * asking: nothing on this screen may create, or promise to create, a board at an address nobody owns.
 * So the failure tests check the address in the bar afterwards as carefully as the message on the
 * page — a page that apologises and then navigates anyway has done the thing it apologised for.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App';
import { checkBoard, createBoardRequest } from '../../src/client/api';
import type { CreateResponse } from '../../src/client/api';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { SilentSocket, dialedRoomUrls, silenceWebSockets } from './helpers/fakeSocket';

// The service, mocked at the one place the pages talk to it. The Worker's half of this is tested
// against the real Worker (tests/integration/share-board.test.ts); what is left to test here is what
// the pages do with the answers, including the answers the Worker is never going to give.
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

const createWasAsked = vi.mocked(createBoardRequest);
const boardWasAsked = vi.mocked(checkBoard);

/** Go to an address, the way a person arrives there: before the app renders. */
function at(path: string): void {
  window.history.pushState(null, '', path);
}

/** Let whatever is already in flight arrive: the answers here are promises, not timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  SilentSocket.dialed.length = 0;
  silenceWebSockets();
  at('/');
  createWasAsked.mockReset();
  boardWasAsked.mockReset();
  // The ordinary answer, for the tests that are not about the service failing: yes, there is a board
  // at that address.
  boardWasAsked.mockResolvedValue({ kind: 'exists' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the home page (TC-16, TC-17)', () => {
  it('makes a board, opens it, and puts its address in the bar (TC-16)', async () => {
    const id = newBoardId();
    let answer: (response: CreateResponse) => void = () => {};
    createWasAsked.mockReturnValue(
      new Promise<CreateResponse>((resolve) => {
        answer = resolve;
      }),
    );

    at('/');
    render(<App />);
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.getByText('A shared board for thinking together')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('new-board'));

    // The button says what it is doing and cannot be pressed again while it does: a second board made
    // by a second click is a board whose link nobody has, in a product where the link is the only way
    // in.
    const button = screen.getByTestId('new-board');
    expect(button).toHaveTextContent('Creating…');
    expect(button).toBeDisabled();
    expect(window.location.pathname).toBe('/');

    await act(async () => {
      answer({ kind: 'created', id });
      await Promise.resolve();
    });

    // The board is not offered, it is opened: the page is gone and the board is here, at the address
    // the service chose.
    expect(window.location.pathname).toBe(`/b/${id}`);
    expect(await screen.findByTestId('board-root')).toBeInTheDocument();
    expect(screen.getByTestId('share-button')).toBeInTheDocument();
    expect(boardWasAsked).toHaveBeenCalledWith(id);
    // The board was asked for by the connection this page opens, at the room this address means.
    expect(dialedRoomUrls()).toEqual([`ws://localhost:3000/api/rooms/${id}`]);
  });

  it.each([
    ['the service answered that it could not make a board', 'failed'],
    ['the request never got an answer at all', 'threw'],
  ] as const)('says so and leaves the button ready when %s (TC-17)', async (_case, failure) => {
    createWasAsked.mockImplementation(() =>
      failure === 'failed'
        ? Promise.resolve<CreateResponse>({ kind: 'failed' })
        : Promise.reject(new TypeError('Failed to fetch')),
    );

    at('/');
    render(<App />);
    fireEvent.click(screen.getByTestId('new-board'));
    await settle();

    expect(screen.getByTestId('create-error')).toHaveTextContent(
      "Couldn't create a board. Please try again.",
    );
    // The two things the message promises, checked rather than assumed: the person did not go
    // anywhere, and the button will answer a second click.
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    const button = screen.getByTestId('new-board');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('New board');

    // And trying again really does ask again: a message that says "please try again" over a button
    // that remembers the failure would be a note telling people to give up.
    fireEvent.click(button);
    await settle();
    expect(createWasAsked).toHaveBeenCalledTimes(2);
  });

  it('does not move a person who left while the board was being made', async () => {
    // The failure this is really guarding: an answer that arrives late. The click was on the home
    // page, the person has since gone somewhere else, and a promise kept now would move them back.
    const id = newBoardId();
    let answer: (response: CreateResponse) => void = () => {};
    createWasAsked.mockReturnValue(
      new Promise<CreateResponse>((resolve) => {
        answer = resolve;
      }),
    );

    at('/');
    const page = render(<App />);
    fireEvent.click(screen.getByTestId('new-board'));
    page.unmount();

    await act(async () => {
      answer({ kind: 'created', id });
      await Promise.resolve();
    });

    // Nothing was opened and nowhere was gone to: the page that asked is gone, and so is its errand.
    expect(window.location.pathname).toBe('/');
    expect(boardWasAsked).not.toHaveBeenCalled();
    expect(SilentSocket.dialed).toEqual([]);
  });
});

describe('opening a board link (TC-19, TC-20, TC-21)', () => {
  it.each(['bad', 'a'.repeat(21), 'a'.repeat(23), 'a'.repeat(22).slice(0, 21) + '!', 'x'.repeat(22) + '/y'])(
    'refuses an address that is not a board address without asking anybody: %s (TC-19)',
    (id) => {
      // The asking is the thing to refuse here. An id that cannot be an id has one answer for every
      // caller, and asking the service for it is how a stranger learns that a mistyped link and
      // somebody's real board are different things.
      at(`/b/${encodeURIComponent(id)}`);
      render(<App />);

      expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
      expect(screen.getByText('Board not found')).toBeInTheDocument();
      expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeInTheDocument();
      expect(boardWasAsked).not.toHaveBeenCalled();
      expect(createWasAsked).not.toHaveBeenCalled();
      // No connection was opened at an address that cannot hold a board, either.
      expect(SilentSocket.dialed).toEqual([]);
    },
  );

  it('says it is opening the board, then says there is no board there (TC-20)', async () => {
    const id = newBoardId();
    // Once, for this board. The board this page goes on to make is a different board, and the honest
    // mock says so: the next ask gets the ordinary answer.
    boardWasAsked.mockResolvedValueOnce({ kind: 'not_found' });

    at(`/b/${id}`);
    render(<App />);

    // Before the answer: what is happening, and nothing that looks like a board. An empty board here
    // would be read as a board whose notes were deleted.
    expect(screen.getByTestId('board-opening')).toHaveTextContent('Opening board…');
    expect(screen.queryByTestId('board-root')).toBeNull();
    expect(screen.queryByTestId('share-button')).toBeNull();

    await settle();

    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
    expect(screen.getByTestId('new-board')).toBeInTheDocument();
    // The other half of the promise: nothing was made at the address that has no board, so the person
    // who types it correctly next time finds the board they meant.
    expect(createWasAsked).not.toHaveBeenCalled();
    expect(SilentSocket.dialed).toEqual([]);
    // And the asking was a question about the board, not a request for one: the Worker's
    // `GET /api/boards/:id`, with the id that was typed.
    expect(boardWasAsked).toHaveBeenCalledTimes(1);

    // And the page's one offer works from here: a new board, which is a different board at a
    // different address, and not this address coming back to life.
    const other = newBoardId();
    createWasAsked.mockResolvedValue({ kind: 'created', id: other });
    fireEvent.click(screen.getByTestId('new-board'));
    await waitFor(() => expect(screen.getByTestId('board-root')).toBeInTheDocument());
    expect(window.location.pathname).toBe(`/b/${other}`);
    expect(createWasAsked).toHaveBeenCalledTimes(1);
  });

  it('keeps asking when the service cannot be reached, and opens the board without a reload (TC-21)', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    boardWasAsked
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ kind: 'exists' });

    at(`/b/${id}`);
    render(<App />);
    await settle();

    // The words for this exact case, and they are the whole difference between this screen and a lie:
    // the service did not say there is no board, so no such thing is suggested.
    expect(screen.getByTestId('board-unreachable-message')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );
    expect(screen.queryByTestId('not-found-page')).toBeNull();
    expect(boardWasAsked).toHaveBeenCalledTimes(1);

    // The first wait, and not a moment before it is due: a retry that fires early is a person hammering
    // a service that is already having a bad minute.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 1);
    });
    expect(boardWasAsked).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(boardWasAsked).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('board-unreachable-message')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );
    // The wait doubles, which is what the second failure is for.
    expect(screen.getByTestId('board-next-check')).toHaveTextContent(
      `next try in ${(BOARD_CHECK_RETRY_BASE_MS * 2) / 1000}s`,
    );

    // The service comes back on its own, and so does the board: no reload, and no page that had
    // already given up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    expect(boardWasAsked).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('board-root')).toBeInTheDocument();
    expect(screen.queryByTestId('board-unreachable')).toBeNull();
    expect(screen.getByTestId('share-button')).toBeInTheDocument();
  });

  it('does not wait forever between tries, however many there have been', async () => {
    // The ceiling is a product setting rather than a detail: it is how long a person is left looking
    // at "Retrying…" before the app tries again, and it is the same wait the board's own connection
    // uses for the same problem.
    vi.useFakeTimers();
    boardWasAsked.mockRejectedValue(new TypeError('Failed to fetch'));
    at(`/b/${newBoardId()}`);
    render(<App />);
    await settle();

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECONNECT_MAX_BACKOFF_MS);
      });
      expect(boardWasAsked).toHaveBeenCalledTimes(attempt + 1);
    }
    expect(screen.getByTestId('board-next-check')).toHaveTextContent(
      `next try in ${RECONNECT_MAX_BACKOFF_MS / 1000}s`,
    );
  });

  it('stops waiting when the person goes somewhere else', async () => {
    // The retry is a timer, and a timer outliving the page that set it is a page that keeps asking
    // about a board nobody is looking at — and then, when the answer comes, one that believes it is
    // still allowed to say something about the screen.
    const id = newBoardId();
    vi.useFakeTimers();
    boardWasAsked.mockRejectedValue(new TypeError('Failed to fetch'));

    at(`/b/${id}`);
    const page = render(<App />);
    await settle();
    expect(boardWasAsked).toHaveBeenCalledTimes(1);

    page.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONNECT_MAX_BACKOFF_MS * 2);
    });

    expect(boardWasAsked).toHaveBeenCalledTimes(1);
  });
});

describe('a board page that already knows the answer', () => {
  it('mounts the board on the first render, with no waiting screen', () => {
    // The seam every board test in this folder leans on, pinned: a checker that answers without a
    // promise is a page that has nothing to wait for, so it must not show a waiting screen. This is
    // also what the app itself does a moment after it opens a board, having just asked.
    const id = newBoardId();
    render(<BoardPage id={id} check={() => ({ kind: 'exists' })} />);
    expect(screen.getByTestId('board-root')).toBeInTheDocument();
    expect(screen.queryByTestId('board-opening')).toBeNull();
  });

  it('treats a checker that throws as a service that did not answer', async () => {
    // The page is not supposed to be given a checker that throws — the real one answers with a state,
    // never an exception — and a page that sits on "Opening board…" forever because something it
    // called blew up has run out of ways to tell the truth.
    render(<BoardPage id={newBoardId()} check={() => { throw new TypeError('no service'); }} />);
    expect(screen.getByTestId('board-unreachable-message')).toHaveTextContent(
      "Couldn't reach vidi6. Retrying…",
    );
  });
});
