/**
 * The Home and Board pages (story 5, task 6: TC-16 to TC-21).
 *
 * These are state-machine tests. The API is a seam, so a test can say "the
 * service answered 429" or "the service was down twice and then fine" without a
 * network, and the timer is a seam too, so the retry test does not sleep. What
 * is *not* faked is the rendering: the pages that ship are mounted, and the
 * assertions are about what a person would see and be able to press.
 *
 * The three things these tests exist to catch:
 *
 *  - a Create that navigates anyway after failing, or that leaves the button
 *    dead (`share.create_failure`);
 *  - a board page that opens a socket before anything has confirmed the board
 *    exists — the fork bug the whole story is built around (`share.not_found`);
 *  - a link check that reads a *failed request* as "no such board" and tells
 *    people their work has been deleted (`share.unreachable`).
 */
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { HomePage, HOME_TEXT } from '../../src/client/pages/Home';
import { BoardPage, BOARD_PAGE_TEXT } from '../../src/client/pages/Board';
import { NOT_FOUND_TEXT } from '../../src/client/pages/NotFound';
import type { BoardCheck, CreateOutcome, FetchImpl } from '../../src/client/api';
import type { ProviderLike } from '../../src/client/sync/connectBoard';

/** A provider that never connects, so mounting a board stays offline. */
class NullProvider implements ProviderLike {
  synced = false;
  wsconnected = false;
  on(): void {}
  send(): void {}
  destroy(): void {}
}

/** A `fetch` that answers with a status, for the API-level cases. */
function response(status: number, body?: unknown): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Click something and let React's async work land. */
async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  // Flush the promise chain the click started, then let React commit.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const button = (container: HTMLElement, testId: string): HTMLButtonElement => {
  const found = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`no button ${testId}`);
  return found;
};

const byTestId = (container: HTMLElement, testId: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe('the home page creates a board (TC-16 to TC-18)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('TC-16 shows Creating… disabled, then opens the board it was given', async () => {
    const created = new Promise<CreateOutcome>((resolve) => {
      setTimeout(() => resolve({ status: 'created', id: 'a'.repeat(22) }), 0);
    });
    const go = vi.fn();
    const { container } = render(<HomePage create={() => created} go={go} />);

    await click(button(container, 'create-board'));

    // The in-flight state is the point: the button must not accept a second
    // press while one create is outstanding.
    const creating = button(container, 'create-board');
    expect(creating.textContent).toBe(HOME_TEXT.creating);
    expect(creating.disabled).toBe(true);

    await act(async () => {
      await created;
      await Promise.resolve();
    });

    expect(go).toHaveBeenCalledWith('/b/' + 'a'.repeat(22));
  });

  it.each([
    ['a 500 from the service', async (): Promise<Response> => response(500)],
    ['a network that throws', async (): Promise<Response> => Promise.reject(new Error('offline'))],
  ])('TC-17 explains the failure for %s, and stays on the home page', async (_label, fetchImpl) => {
    const go = vi.fn();
    const create = async (): Promise<CreateOutcome> => {
      const { createBoard } = await import('../../src/client/api');
      return createBoard(fetchImpl as FetchImpl);
    };
    const { container } = render(<HomePage create={create} go={go} />);

    await click(button(container, 'create-board'));

    const message = byTestId(container, 'create-failed');
    expect(message).not.toBeNull();
    expect(message?.textContent).toBe(HOME_TEXT.failed);
    // Both halves of `share.create_failure`: the message, and a button that
    // works again. A dead button would strand the person on the page.
    const again = button(container, 'create-board');
    expect(again.disabled).toBe(false);
    expect(again.textContent).toBe(HOME_TEXT.create);
    expect(go).not.toHaveBeenCalled();
  });

  it('TC-18 names the rate limit, and does not navigate', async () => {
    const go = vi.fn();
    const create = async (): Promise<CreateOutcome> => {
      const { createBoard } = await import('../../src/client/api');
      return createBoard(async () => response(429));
    };
    const { container } = render(<HomePage create={create} go={go} />);

    await click(button(container, 'create-board'));

    expect(byTestId(container, 'create-limited')?.textContent).toBe(HOME_TEXT.limited);
    expect(byTestId(container, 'create-failed')).toBeNull();
    expect(button(container, 'create-board').disabled).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });
});

/**
 * A timer the test drives. The board page's retries are scheduled through the
 * injected `delay`, so a retry test can step through two backoff intervals
 * without waiting three seconds, and can still assert the *lengths*.
 */
function fakeClock(): {
  delay: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearDelay: (handle: ReturnType<typeof setTimeout>) => void;
  pending: () => Array<{ callback: () => void; ms: number }>;
  take: () => Array<{ callback: () => void; ms: number }>;
} {
  const scheduled = new Map<number, { callback: () => void; ms: number }>();
  let next = 1;
  return {
    delay: (callback, ms) => {
      const handle = next++ as unknown as ReturnType<typeof setTimeout>;
      scheduled.set(Number(handle), { callback, ms });
      return handle;
    },
    clearDelay: (handle) => {
      scheduled.delete(Number(handle));
    },
    pending: () => [...scheduled.values()],
    take: () => {
      const due = [...scheduled.values()];
      scheduled.clear();
      return due;
    },
  };
}

describe('the board page checks the link before it opens anything (TC-19 to TC-21)', () => {
  it('TC-19 sends no request for an id that is not an id', async () => {
    const check = vi.fn(async (): Promise<BoardCheck> => ({ status: 'not_found' }));
    const providerFactory = vi.fn(() => new NullProvider());
    const { container } = render(
      <BoardPage boardId="abc" check={check} providerFactory={providerFactory} />,
    );

    // A truncated link is answered from the shape alone (`share.unguessable`).
    expect(check).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();
    expect(byTestId(container, 'not-found-page')).not.toBeNull();
  });

  it('TC-20 waits, then offers a new board rather than an empty one', async () => {
    const boardId = newBoardId();
    let answer: ((check: BoardCheck) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<BoardCheck>((resolve) => {
          answer = resolve;
        }),
    );
    const providerFactory = vi.fn(() => new NullProvider());

    const first = render(
      <BoardPage boardId={boardId} check={check} providerFactory={providerFactory} />,
    );
    // The waiting state is a real state: a blank board is what people mistake
    // for deleted work.
    expect(byTestId(first.container, 'board-loading-text')?.textContent).toBe(
      BOARD_PAGE_TEXT.opening,
    );

    await act(async () => {
      answer?.({ status: 'not_found' });
      await Promise.resolve();
    });

    expect(byTestId(first.container, 'not-found-page')).not.toBeNull();
    expect(byTestId(first.container, 'not-found-advice')?.textContent).toBe(NOT_FOUND_TEXT.lead);
    expect(button(first.container, 'create-board').textContent).toBe(NOT_FOUND_TEXT.create);
    expect(providerFactory).not.toHaveBeenCalled();

    // The offer works: a new board is created, and it is a *different* board.
    const go = vi.fn();
    const second = render(
      <BoardPage
        boardId={boardId}
        check={async () => ({ status: 'exists', id: boardId })}
        providerFactory={providerFactory}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId(second.container, 'board-page')).not.toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it('TC-21 retries an unreachable service and opens the board without a reload', async () => {
    const boardId = newBoardId();
    const clock = fakeClock();
    const attempts: BoardCheck[] = [
      { status: 'unavailable' },
      { status: 'unavailable' },
      { status: 'exists', id: boardId },
    ];
    const check = vi.fn(async (): Promise<BoardCheck> => {
      const next = attempts.shift();
      return next ?? { status: 'not_found' };
    });

    const { container } = render(
      <BoardPage
        boardId={boardId}
        check={check}
        delay={clock.delay}
        clearDelay={clock.clearDelay}
        providerFactory={() => new NullProvider()}
      />,
    );

    // The first answer changes the message, not the page.
    await act(async () => {
      await Promise.resolve();
    });
    expect(byTestId(container, 'board-loading-text')?.textContent).toBe(
      BOARD_PAGE_TEXT.retrying,
    );
    expect(byTestId(container, 'not-found-page')).toBeNull();

    // Two backoff intervals, doubling from the named setting: 1s then 2s.
    const first = clock.take();
    expect(first.map((entry) => entry.ms)).toEqual([BOARD_CHECK_RETRY_BASE_MS]);
    await act(async () => {
      for (const entry of first) entry.callback();
      await Promise.resolve();
    });

    const second = clock.take();
    expect(second.map((entry) => entry.ms)).toEqual([BOARD_CHECK_RETRY_BASE_MS * 2]);
    await act(async () => {
      for (const entry of second) entry.callback();
      await Promise.resolve();
    });

    // Three asks, and the third one is the answer: the board opens by itself.
    expect(check).toHaveBeenCalledTimes(3);
    expect(byTestId(container, 'board-page')).not.toBeNull();
    expect(byTestId(container, 'board-loading')).toBeNull();
  });

  it('keeps retrying rather than calling a dead service a missing board', async () => {
    const boardId = newBoardId();
    const clock = fakeClock();
    const check = vi.fn(async (): Promise<BoardCheck> => ({ status: 'unavailable' }));

    const { container } = render(
      <BoardPage
        boardId={boardId}
        check={check}
        delay={clock.delay}
        clearDelay={clock.clearDelay}
        providerFactory={() => new NullProvider()}
      />,
    );

    // Six rounds of backoff, and the page never once claims the board is gone.
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await Promise.resolve();
      });
      const due = clock.take();
      expect(due.length).toBe(1);
      expect(byTestId(container, 'not-found-page')).toBeNull();
      await act(async () => {
        for (const entry of due) entry.callback();
        await Promise.resolve();
      });
    }

    expect(check.mock.calls.length).toBeGreaterThan(1);
    // Past the second interval the wait is capped, not doubled forever.
    const capped = clock.pending().map((entry) => entry.ms);
    expect(capped.every((ms) => ms <= 30_000)).toBe(true);
  });
});
