/**
 * TC-16, TC-17, TC-19, TC-20, TC-21 — the two pages, and the question the board
 * page asks before it opens anything.
 *
 * These mount the *whole app* (`App` → router → page) against a `fetch` that is
 * the only fake in the room: which page an address is comes from the location bar,
 * so a test that mounted a page directly could not tell whether the router agreed.
 * `fetch` is the seam because it is the app's one way out — a board answer is
 * something the server says, and here it is said on a schedule the test chooses.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config';
import { existenceRetryDelay } from '../../src/client/sync/existence';

import { COMPONENT_BOARD_ID } from './helpers/board';

/** A `fetch` that answers, and remembers being asked. */
class FakeApi {
  readonly calls: { method: string; url: string }[] = [];
  /**
   * Statuses `GET /api/boards/:id` answers with, in order; the last one is then
   * repeated. A queue is what makes "unreachable twice and then there it is"
   * (TC-21) a thing a test can say.
   */
  answers: number[] = [200];
  /** The board `POST /api/boards` makes, or null when creation fails. */
  created: string | null = newBoardId();

  install(): void {
    const fakeFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const url = String(args[0]);
      const method = args[1]?.method ?? 'GET';
      this.calls.push({ method, url });
      if (url === '/api/boards' && method === 'POST') {
        return this.created === null
          ? json({ error: 'create_failed' }, 500)
          : json({ id: this.created }, 201);
      }
      if (url.startsWith('/api/boards/')) {
        const status = this.answers.shift() ?? this.answers.at(-1) ?? 200;
        return status === 200
          ? json({ id: url.slice('/api/boards/'.length) }, 200)
          : json({ error: 'not_found' }, status);
      }
      throw new Error(`the app asked something this fake is not: ${method} ${url}`);
    };
    vi.stubGlobal('fetch', fakeFetch);
  }

  /** Every check of a board's existence, oldest first. */
  checks(): string[] {
    return this.calls.filter((call) => call.url.startsWith('/api/boards/')).map((c) => c.url);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let api: FakeApi;

beforeEach(() => {
  api = new FakeApi();
  api.install();
  // The location bar is part of the input to these tests, so it starts somewhere.
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the app is two pages, chosen by the address (TC-16, TC-20)', () => {
  it('keeps the pages in separate files that never look at a URL', () => {
    // TC-16, read straight off the source: two page styles rather than one
    // component switching on a prop, and no page that knows what an address is.
    const pages = readdirSync('src/client/pages');
    expect(pages).toContain('HomePage.tsx');
    expect(pages).toContain('BoardPage.tsx');
    expect(pages).toContain('NotFoundPage.tsx');

    const urlShaped = /window\.location|location\.pathname|history\.(push|replace)State|new URL\(/;
    for (const file of pages) {
      const source = readFileSync(`src/client/pages/${file}`, 'utf8');
      expect(urlShaped.test(source), `${file} parses the address`).toBe(false);
    }
    // The home page takes no prop: there is no switch that could turn it into a
    // board, so the two cannot drift into one component with a flag.
    expect(readFileSync('src/client/pages/HomePage.tsx', 'utf8')).toMatch(
      /export function HomePage\(\)/,
    );
  });

  it('shows the home page at / and nothing that could be a board', () => {
    render(<App />);
    expect(screen.getByTestId('home-page')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
    expect(document.querySelector('.board-app')).toBeNull();
    expect(document.querySelector('.board-toolbar')).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it('shows the board, and no way to start another one, at /b/<id>', async () => {
    window.history.replaceState({}, '', `/b/${COMPONENT_BOARD_ID}`);
    render(<App />);
    // The question first, in words that do not promise a board that is not known.
    const checking = await screen.findByTestId('board-page');
    expect(checking.textContent).toContain('Opening board…');
    // And then the board itself, with the toolbar that means it can be worked on.
    await screen.findByTestId('board-app');
    expect(document.querySelector('.board-toolbar')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'New board' })).toBeNull();
    expect(api.checks()).toEqual([`/api/boards/${COMPONENT_BOARD_ID}`]);
  });

  it('makes a board when New board is pressed, and goes to it', async () => {
    const made = 'newboard0000000000000a';
    api.created = made;
    render(<App />);
    act(() => screen.getByRole('button', { name: 'New board' }).click());
    // A link is only ever written by the router, and the app ends up at it.
    await screen.findByTestId('board-app');
    expect(window.location.pathname).toBe(`/b/${made}`);
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/boards' });
  });

  it('says when a board could not be made, and lets the button go again', async () => {
    api.created = null; // share.create_failure
    render(<App />);
    act(() => screen.getByRole('button', { name: 'New board' }).click());
    expect(await screen.findByTestId('new-board-error')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'New board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });
});

describe('an address that is not a board (TC-19, negative)', () => {
  it.each(['/made-up', '/b/', '/b/made-up', '/b/tooShort', '/b/SPUq8nMPQEGm7c5BpXmzK+', '/api/boards/123'])(
    'renders the not-found page for %s without asking the server',
    (path) => {
      window.history.replaceState({}, '', path);
      render(<App />);
      expect(screen.getByTestId('not-found')).toBeTruthy();
      // No board, nothing like a board, and — the part a sloppy router gets wrong —
      // no request either: an address that cannot name a board is answered here.
      expect(document.querySelector('.board-app')).toBeNull();
      expect(document.querySelector('.board-toolbar')).toBeNull();
      expect(document.querySelector('canvas')).toBeNull();
      expect(api.calls).toEqual([]);
    },
  );

  it('shows the address it could not find', () => {
    window.history.replaceState({}, '', '/b/made-up');
    render(<App />);
    expect(screen.getByTestId('not-found-path').textContent).toContain('/b/made-up');
  });
});

/**
 * TC-21: the check is on a schedule, and the schedule is what a person standing at
 * a wrong link experiences — one answer now, and the next a second later.
 */
describe('a board that is not there yet (TC-21)', () => {
  it('doubles the wait between checks, up to the reconnect cap', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(existenceRetryDelay)).toEqual([
      BOARD_CHECK_RETRY_BASE_MS,
      2_000,
      4_000,
      8_000,
      RECONNECT_MAX_BACKOFF_MS,
      RECONNECT_MAX_BACKOFF_MS,
      RECONNECT_MAX_BACKOFF_MS,
    ]);
  });

  it('asks again while vidi6 cannot be reached, doubling the wait, and opens the board when it can', async () => {
    vi.useFakeTimers();
    // Two answers that are not about the board at all, then the truth (TC-21).
    api.answers = [500, 500, 200];
    const boardId = newBoardId();
    window.history.replaceState({}, '', `/b/${boardId}`);

    const { container } = render(<App />);
    // First the question, and only the question: nothing that could be a board.
    expect(container.querySelector('[data-testid="board-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board-app"]')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // The failure is admitted in words, because "Board not found" would be a lie.
    expect(
      container.querySelector('[data-testid="board-status"]')?.textContent,
    ).toContain('Couldn’t reach vidi6. Retrying…');
    expect(container.querySelector('[data-testid="not-found"]')).toBeNull();
    expect(api.checks()).toHaveLength(1);

    // 999ms of the wait: nothing was asked, so nothing a board could be opened from.
    await act(async () => {
      // One millisecond short of the wait: 1ms was already spent above.
      await vi.advanceTimersByTimeAsync(BOARD_CHECK_RETRY_BASE_MS - 2);
    });
    expect(api.checks()).toHaveLength(1);

    // The second attempt lands a second after the first, and the third two seconds
    // after that — doubling, and never more often than the reconnect ever is.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.checks()).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(api.checks()).toHaveLength(3);
    // And the third answer was yes: the board is on screen, without a reload and
    // with the toolbar a board is worked on with.
    expect(container.querySelector('[data-testid="board-app"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board-toolbar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board-status"]')).toBeNull();
  });

  it('stops asking once vidi6 has said there is no board here', async () => {
    vi.useFakeTimers();
    api.answers = [404];
    const boardId = newBoardId();
    window.history.replaceState({}, '', `/b/${boardId}`);

    const { container } = render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[data-testid="not-found"]')).not.toBeNull();
    expect(container.querySelector('.board-toolbar')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(api.checks()).toHaveLength(1);

    // A minute later: still one request. Boards are not deleted, so a second read
    // of an address the server refused could not change this page.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.checks()).toHaveLength(1);
    expect(container.querySelector('[data-testid="not-found"]')).not.toBeNull();
  });
});

/**
 * TC-17 at the level a component test can reach: two boards open in one document
 * keep their notes apart. What makes this non-vacuous is that the notes come from
 * one board's own document through the real model, so a shared document — the way
 * this could plausibly break — shows up as a note in the wrong container.
 */
describe('two boards in one browser (TC-17)', () => {
  it('never shows one board another board’s notes', async () => {
    const firstId = 'firstboard00000000000x';
    const secondId = 'secondboard0000000000y';
    window.history.replaceState({}, '', `/b/${firstId}`);
    render(<App />);
    // Both boards have to be answered "here" before either exists on screen, so
    // the check is part of the path a board takes even in a test about isolation.
    await screen.findByTestId('board-app');

    // The first board has a note; it is seeded through the test hook, which
    // mutates that session's document the way another client would.
    let seeded: string[] = [];
    act(() => {
      seeded = seedStickyThroughHook('only on the first board');
    });
    expect(seeded).toHaveLength(1);
    const first = boardElement();
    expect(first.dataset.boardId).toBe(firstId);
    expect(first.querySelectorAll('[data-note-id]')).toHaveLength(1);

    // The second board is opened by navigating: the first page is replaced, not
    // stacked, so two boards are never open at once.
    act(() => {
      window.history.pushState({}, '', `/b/${secondId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await screen.findByTestId('board-app');
    const second = boardElement();
    expect(second).not.toBe(first);
    expect(second.dataset.boardId).toBe(secondId);
    // Nothing of the first board came with it.
    expect(second.querySelectorAll('[data-note-id]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="board-app"]')).toHaveLength(1);
  });
});

/** The board element, and the address it belongs to. */
function boardElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-testid="board-app"]');
  if (!element) throw new Error('no board is mounted');
  return element;
}

/** Seed one note into whichever board session is currently mounted. */
function seedStickyThroughHook(text: string): string[] {
  const hook = window.__vidi6Board;
  if (!hook) throw new Error('no board session is mounted to seed');
  return hook.seed([{ x: 40, y: 40, color: 'yellow', text }]);
}
