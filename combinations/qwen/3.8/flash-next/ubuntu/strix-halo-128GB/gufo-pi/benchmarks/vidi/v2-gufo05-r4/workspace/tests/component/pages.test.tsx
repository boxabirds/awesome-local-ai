/**
 * Home, board and Board not found (TC-16, TC-17, TC-19 to TC-21).
 *
 * These are the page state machines, so the boundary is the network and nothing else:
 * `api.ts` is mocked and everything above it — the router, the reducer in `pages/state`, the
 * three pages and the real board components — runs. The board's own WebSocket is stubbed at
 * `connectBoard`, because a component test that opened a socket would be an integration test
 * that had lost its way, and because "the board is on screen" is asserted by looking for the
 * board's own markers in the DOM.
 *
 * The timing cases use fake timers and check the waits on both sides: a retry that fires one
 * millisecond early would hammer an unreachable service, and one that never fires is a page
 * that says "Retrying…" forever.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import type { CheckResponse, CreateResponse } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

/** Hoisted so the module mocks below can reach it. */
const harness = vi.hoisted(() => ({
  createBoardRequest: vi.fn<() => Promise<CreateResponse>>(),
  checkBoard: vi.fn<(id: string) => Promise<CheckResponse>>()
}));

vi.mock('../../src/client/api', () => harness);

/* The board's live connection, replaced by a handle that goes nowhere: these tests are about
   whether the board is on screen, and a real provider in jsdom would spend the test failing to
   reach a server that is not running. */
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return { ...actual, connectBoard: () => ({ destroy: () => undefined }) };
});

/** A promise a test resolves itself, so an in-flight request can be looked at. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Put the app at a path, the way an address bar does. */
function goTo(path: string): void {
  window.history.replaceState(null, '', path);
}

/** The one button in the app whose label these tests match on. */
function buttonElement(name: RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** Is the board itself on screen? The viewport and the tool palette are the board's own. */
function boardRendered(): boolean {
  return document.querySelector('[data-vidi6="viewport"]') !== null;
}

/** Run the timers, then let the promises they started settle inside React. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  goTo('/');
  vi.mocked(harness.createBoardRequest).mockReset();
  vi.mocked(harness.checkBoard).mockReset();
  // Most tests reach a board, and a board page that got `undefined` back from the check
  // would not be a page under test but a broken mock.
  harness.checkBoard.mockResolvedValue({ kind: 'exists' });
});

afterEach(() => {
  cleanup();
  if (vi.isFakeTimers()) vi.useRealTimers();
});

describe('the home page', () => {
  // TC-16
  it('asks for a board, says so while it waits, and opens what it gets', async () => {
    const id = newBoardId();
    const pending = deferred<CreateResponse>();
    harness.createBoardRequest.mockReturnValue(pending.promise);
    render(<App />);

    const button = screen.getByRole('button', { name: /new board/i });
    // A synchronous click, so the in-flight state can be looked at before it is over:
    // the button is the disabled "Creating…" button while the request is open, which is what
    // stops a second click making a second board.
    act(() => {
      button.click();
    });
    expect(buttonElement(/creating/i).disabled).toBe(true);
    expect(harness.createBoardRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ kind: 'created', id });
    });

    // The address changed by itself, not by a reload, and the board is there underneath.
    expect(window.location.pathname).toBe(`/b/${id}`);
    expect(boardRendered()).toBe(true);
  });

  /*
   * TC-17 (`share.create_failure`), twice.
   *
   * The design asks for the 500 and the network error as two runs. The page cannot tell them
   * apart, and that is `api.ts` doing its job: both come back `{ kind: 'failed' }`, because a
   * person does something different for neither. The collapse itself — two different answers at
   * `fetch`, one answer for the page — is tested against a stubbed `fetch` at the bottom of this
   * file.
   */
  it.each([
    ['a server that answered 500', { kind: 'failed' } as CreateResponse],
    ['a request that never arrived', { kind: 'failed' } as CreateResponse]
  ])(
    'stays home and explains %s, with the button ready to try again',
    async (_name, response) => {
      harness.createBoardRequest.mockResolvedValue(response);
      render(<App />);

      await userEvent.setup().click(screen.getByRole('button', { name: /new board/i }));

      expect(screen.getByText("Couldn't create a board. Please try again.")).toBeDefined();
      // Nobody was moved: the address bar still says home, and there is no board behind it.
      expect(window.location.pathname).toBe('/');
      expect(boardRendered()).toBe(false);
      expect(buttonElement(/new board/i).disabled).toBe(false);
    }
  );
});

describe('a board address', () => {
  // TC-19 (`share.not_found`)
  it('says Board not found for a code that cannot be one, without asking the server', async () => {
    goTo('/b/bad');
    render(<App />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Board not found');
    expect(harness.checkBoard).not.toHaveBeenCalled();
    expect(boardRendered()).toBe(false);
    // The way out is the same action the home page offers.
    expect(screen.getByRole('button', { name: /new board/i })).toBeDefined();
  });

  // TC-20
  it('says Opening board… and then Board not found when the server says no', async () => {
    const pending = deferred<CheckResponse>();
    harness.checkBoard.mockReturnValue(pending.promise);
    goTo(`/b/${newBoardId()}`);
    render(<App />);

    expect(screen.getByText('Opening board…')).toBeDefined();
    expect(harness.checkBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ kind: 'not_found' });
    });

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Board not found');
    expect(boardRendered()).toBe(false);
  });

  // TC-21 (`share.unreachable`)
  it('retries an unreachable service on a doubling wait and opens the board when it can', async () => {
    vi.useFakeTimers();
    harness.checkBoard
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValue({ kind: 'exists' });
    const id = newBoardId();
    goTo(`/b/${id}`);
    render(<App />);

    await tick(0);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeDefined();
    expect(boardRendered()).toBe(false);

    // First wait: `BOARD_CHECK_RETRY_BASE_MS`, and not a millisecond before.
    await tick(BOARD_CHECK_RETRY_BASE_MS - 1);
    expect(harness.checkBoard).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(harness.checkBoard).toHaveBeenCalledTimes(2);

    // Second wait: doubled. The service is unreachable, and a page that hammers it makes
    // that worse for everybody else using it.
    await tick(BOARD_CHECK_RETRY_BASE_MS * 2 - 1);
    expect(harness.checkBoard).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(harness.checkBoard).toHaveBeenCalledTimes(3);

    // The board opened without a reload, which is the whole point of retrying (`share.unreachable`).
    expect(boardRendered()).toBe(true);
    expect(window.location.pathname).toBe(`/b/${id}`);
  });

  // `share.link_stable`: two addresses are two boards.
  it('gives a second board a fresh page rather than the first board with a new address', async () => {
    const first = newBoardId();
    const second = newBoardId();
    harness.checkBoard.mockResolvedValue({ kind: 'exists' });
    goTo(`/b/${first}`);
    render(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(boardRendered()).toBe(true);

    await act(async () => {
      window.history.pushState({}, '', `/b/${second}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(harness.checkBoard).toHaveBeenLastCalledWith(second);
    expect(window.location.pathname).toBe(`/b/${second}`);
  });
});

/**
 * `api.ts` itself, one level down. The page tests above mock it, which is right for the pages
 * and wrong for these two lines of contract: a 500 and a refused connection have to arrive as
 * `failed` and `unreachable` respectively, and nothing else can tell them apart later.
 */
describe('the board API client', () => {
  /** The real module, with the module-level mock set aside for these cases. */
  async function realApi(): Promise<typeof import('../../src/client/api')> {
    return vi.importActual<typeof import('../../src/client/api')>('../../src/client/api');
  }

  function stubFetch(implementation: () => Response | Promise<Response>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn<() => Promise<Response>>(async () => implementation())
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['a 500 from the Worker', () => new Response('{}', { status: 500 })],
    ['a refused connection', () => Promise.reject(new Error('offline'))]
  ])('treats %s as a failed creation', async (_name, behaviour) => {
    stubFetch(behaviour);
    const api = await realApi();
    expect((await api.createBoardRequest()).kind).toBe('failed');
  });

  it('reads a created board out of the response', async () => {
    const id = newBoardId();
    stubFetch(() => Promise.resolve(Response.json({ id }, { status: 201 })));
    const api = await realApi();
    expect(await api.createBoardRequest()).toEqual({ kind: 'created', id });
  });

  it('refuses to believe a creation response that holds no board address', async () => {
    stubFetch(() => Promise.resolve(Response.json({ id: 'board' }, { status: 201 })));
    const api = await realApi();
    expect((await api.createBoardRequest()).kind).toBe('failed');
  });

  it.each([
    ['404 is a board that is not there', 404, 'not_found'],
    ['500 is a service that did not answer', 500, 'unreachable'],
    ['a refused connection is a service that did not answer', 0, 'unreachable']
  ] as const)('%s', async (_name, status, expected) => {
    stubFetch(() =>
      status === 0
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(new Response('{}', { status }))
    );
    const api = await realApi();
    expect((await api.checkBoard(newBoardId())).kind).toBe(expected);
  });

  it('does not ask the server about a code that cannot be a board', async () => {
    const fetchMock = vi.fn<() => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
    const api = await realApi();
    expect((await api.checkBoard('abc')).kind).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
