// Home / Board / not-found pages (spec: share.pages, TC-16 to TC-21).
//
// api.ts is mocked globally (setup.ts); every test resets both mocks and
// installs the behaviour it needs. Fake timers throughout: BoardPage's
// existence-check retries are timer-driven.
//
// (jest-dom is unavailable in this offline environment: presence is asserted
// with getBy* (which throws when absent) and absence with query*.)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { screen } from '@testing-library/react';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';
import { checkBoard, createBoardRequest, type CheckResult } from '../../src/client/api';
import {
  installResizeObserverMock,
  renderApp,
  ResizeObserverMock,
  TEST_VIEWPORT_HEIGHT,
  TEST_VIEWPORT_WIDTH,
  viewportEl,
} from './helpers';

/** Advance fake time inside act so timer-driven checks (and their promise
 * resolutions) settle under React. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Give a freshly mounted board the fixture viewport size. */
function sizeBoard(): void {
  const observer = ResizeObserverMock.instances[ResizeObserverMock.instances.length - 1];
  if (observer !== undefined) observer.fire(TEST_VIEWPORT_WIDTH, TEST_VIEWPORT_HEIGHT);
}

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
  vi.mocked(checkBoard).mockReset();
  vi.mocked(createBoardRequest).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('share.pages', () => {
  it('TC-16: / shows the tagline and a "Create a board" button', async () => {
    vi.mocked(checkBoard).mockResolvedValue({ status: 'exists' });
    const { container } = await renderApp('/');
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a board' })).toBeTruthy();
    expect(container.querySelector('[data-testid="board-viewport"]')).toBeNull();
  });

  it('TC-17: create success navigates to /b/<id> and mounts the board', async () => {
    const id = newBoardId();
    vi.mocked(createBoardRequest).mockResolvedValue({ status: 'created', id });
    vi.mocked(checkBoard).mockResolvedValue({ status: 'exists' });

    const { container } = await renderApp('/');
    const button = screen.getByRole('button', { name: 'Create a board' });
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createBoardRequest).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(`/b/${id}`);
    // BoardPage checks existence, then mounts the board.
    await tick(0);
    sizeBoard();
    expect(viewportEl(container)).not.toBeNull();
  });

  it('TC-18: create failure shows the retry message and re-enables the button', async () => {
    vi.mocked(createBoardRequest).mockResolvedValue({ status: 'failed' });
    const { container } = await renderApp('/');
    const button = screen.getByRole('button', { name: 'Create a board' });

    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(
      screen.getByText("Couldn't create a board. Please try again."),
    ).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
    expect(container.querySelector('[data-testid="board-viewport"]')).toBeNull();
  });

  it('TC-19: unknown board → not found page; malformed id → not found, no request', async () => {
    vi.mocked(checkBoard).mockResolvedValue({ status: 'not_found' });
    const id = newBoardId();
    const first = await renderApp(`/b/${id}`);
    expect(screen.getByText('Board not found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a new board' })).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledTimes(1);
    expect(first.container.querySelector('[data-testid="board-viewport"]')).toBeNull();

    // Malformed id: the negative — no request at all.
    first.unmount();
    vi.mocked(checkBoard).mockClear();
    const malformed = 'NOT A VALID ID!!';
    const second = await renderApp(`/b/${encodeURIComponent(malformed)}`);
    expect(screen.getByText('Board not found')).toBeTruthy();
    expect(checkBoard).not.toHaveBeenCalled();
    expect(second.container.querySelector('[data-testid="board-viewport"]')).toBeNull();
  });

  it('TC-20: exists → "Opening board…" then the board mounts', async () => {
    const id = newBoardId();
    // Hold the check pending so the intermediate "Opening board…" state is
    // observable.
    let resolveCheck: (result: CheckResult) => void = () => {};
    vi.mocked(checkBoard).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );

    const { container } = await renderApp(`/b/${id}`);
    expect(screen.getByText('Opening board…')).toBeTruthy();
    expect(container.querySelector('[data-testid="board-viewport"]')).toBeNull();

    await act(async () => {
      resolveCheck({ status: 'exists' });
    });
    sizeBoard();
    expect(viewportEl(container)).not.toBeNull();
    expect(checkBoard).toHaveBeenCalledTimes(1);
  });

  it('TC-21: unreachable → retry with backoff (base, 2x); exists ends the loop', async () => {
    const id = newBoardId();
    vi.mocked(checkBoard)
      .mockResolvedValueOnce({ status: 'unreachable' })
      .mockResolvedValueOnce({ status: 'unreachable' })
      .mockResolvedValueOnce({ status: 'exists' });

    const { container } = await renderApp(`/b/${id}`);
    // Initial check (delay 0, flushed by renderApp).
    expect(screen.getByText(/Couldn’t reach vidi6\. Retrying/)).toBeTruthy();
    expect(checkBoard).toHaveBeenCalledTimes(1);

    await tick(BOARD_CHECK_RETRY_BASE_MS);
    expect(checkBoard).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Couldn’t reach vidi6\. Retrying/)).toBeTruthy();

    await tick(BOARD_CHECK_RETRY_BASE_MS * 2);
    expect(checkBoard).toHaveBeenCalledTimes(3);
    sizeBoard();
    expect(viewportEl(container)).not.toBeNull();
  });
});
