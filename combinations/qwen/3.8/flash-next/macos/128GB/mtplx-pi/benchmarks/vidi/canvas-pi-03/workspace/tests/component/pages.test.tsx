// Story 5 — pages (share.pages, task 6).
//
// The Home / Board / Not-found page state machines, driven with a MOCKED
// api.ts (the design's "mocked api.ts" boundary — these tests prove the page
// state machines, not the network) and fake timers for the retry backoff.
//
// api.ts is mocked with a hoisted mutable holder so each test can set the
// create/check response before rendering, without the factory seeing an
// uninitialised import.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

// A single mutable holder the mocked api reads through. `vi.hoisted` guarantees
// it exists before the hoisted `vi.mock` factory runs.
const { api } = vi.hoisted(() => ({
  api: {
    create: null as null | (() => Promise<{ kind: string; id?: string }>),
    check: null as null | ((id: string) => Promise<{ kind: string }>),
    createCalls: 0,
    checkCalls: 0,
  },
}));

vi.mock('../../src/client/api', () => ({
  createBoardRequest: () => {
    api.createCalls += 1;
    return api.create ? api.create() : Promise.resolve({ kind: 'failed' });
  },
  checkBoard: (id: string) => {
    api.checkCalls += 1;
    return api.check ? api.check(id) : Promise.resolve({ kind: 'unreachable' });
  },
}));

const { HomePage } = await import('../../src/client/pages/HomePage');
const { BoardPage } = await import('../../src/client/pages/BoardPage');

beforeEach(() => {
  api.create = null;
  api.check = null;
  api.createCalls = 0;
  api.checkCalls = 0;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomePage (share.create)', () => {
  // TC-16
  it('TC-16: clicking Create shows "Creating…" disabled, then navigates to /b/<id>', async () => {
    let resolve!: (v: { kind: string; id?: string }) => void;
    api.create = () => new Promise((r) => (resolve = r));
    render(<HomePage />);
    const button = screen.getByTestId<HTMLButtonElement>('create-board');
    expect(button.textContent).toBe('Create a board');
    expect(button.disabled).toBe(false);

    act(() => {
      button.click();
    });
    // Pending: the button re-renders to "Creating…" and is disabled.
    expect(button.textContent).toBe('Creating…');
    expect(button.disabled).toBe(true);

    await act(async () => {
      resolve({ kind: 'created', id: 'a1b2c3d4e5f6g7h8i9j0k1' });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(window.location.pathname).toBe('/b/a1b2c3d4e5f6g7h8i9j0k1'));
  });

  // TC-17: 500 and network error, two runs.
  it.each([
    ['500', undefined],
    ['network error', undefined],
  ])('TC-17 (%s): keeps the home page, re-enables the button, shows the failure copy', async (_label) => {
    api.create = () => Promise.resolve({ kind: 'failed' });
    render(<HomePage />);
    const button = screen.getByTestId<HTMLButtonElement>('create-board');
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const message = screen.getByTestId('create-message');
    expect(message.textContent).toBe("Couldn't create a board. Please try again.");
    expect(button.disabled).toBe(false);
    // Negative: no navigation happened (route still the home page).
    expect(window.location.pathname).toBe('/');
  });

  // TC-18
  it('TC-18: rate_limited shows the rate-limit copy and re-enables the button', async () => {
    api.create = () => Promise.resolve({ kind: 'rate_limited' });
    render(<HomePage />);
    const button = screen.getByTestId<HTMLButtonElement>('create-board');
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const message = screen.getByTestId('create-message');
    expect(message.textContent).toBe(
      "You're creating boards too quickly. Wait a minute and try again.",
    );
    expect(button.disabled).toBe(false);
    expect(window.location.pathname).toBe('/');
  });
});

describe('BoardPage (share.open_link / share.unreachable)', () => {
  const VALID = 'a1b2c3d4e5f6g7h8i9j0k1'; // 22 base64url chars

  // TC-19
  it('TC-19: a malformed id renders Board not found and sends NO request', () => {
    window.history.replaceState(null, '', '/b/bad');
    render(<BoardPage id="bad" />);
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(api.checkCalls).toBe(0);
    expect(api.check).toBeNull();
  });

  // TC-20
  it('TC-20: an unknown valid id shows "Opening board…" then Board not found', async () => {
    api.check = () => Promise.resolve({ kind: 'not_found' });
    window.history.replaceState(null, '', `/b/${VALID}`);
    render(<BoardPage id={VALID} />);
    // First paint is the loading state.
    expect(screen.getByTestId('opening-board')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('not-found-page')).toBeTruthy());
    // And it offers a "Create a new board" button.
    expect(screen.getByTestId<HTMLButtonElement>('create-board').textContent).toBe('Create a new board');
  });

  // TC-21: unreachable twice then exists; backoff 1× then 2×; three calls.
  it('TC-21: unreachable → retry → unreachable → retry → board, three checks', async () => {
    vi.useFakeTimers();
    const results: Array<{ kind: string }> = [
      { kind: 'unreachable' },
      { kind: 'unreachable' },
      { kind: 'exists' },
    ];
    let n = 0;
    api.check = () => Promise.resolve(results[n++]);
    window.history.replaceState(null, '', `/b/${VALID}`);

    await act(async () => {
      render(<BoardPage id={VALID} />);
      await Promise.resolve();
    });
    expect(screen.getByTestId('unreachable-board')).toBeTruthy();
    expect(api.checkCalls).toBe(1);

    // First backoff interval (BOARD_CHECK_RETRY_BASE_MS = 1000).
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.checkCalls).toBe(2);
    expect(screen.getByTestId('unreachable-board')).toBeTruthy();

    // Second backoff interval (doubled → 2000).
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.checkCalls).toBe(3);
    expect(screen.getByTestId('board-page')).toBeTruthy();
  });

  it('BoardPage mounts the board UI + Share panel once the board exists', async () => {
    api.check = () => Promise.resolve({ kind: 'exists' });
    window.history.replaceState(null, '', `/b/${VALID}`);
    render(<BoardPage id={VALID} />);
    await waitFor(() => expect(screen.getByTestId('board-page')).toBeTruthy());
    const shareButton = screen.getByTestId('share-button');
    expect(shareButton).toBeTruthy();
    // The panel starts closed; opening it reveals the read-only link field
    // (share.copy), which holds the full board link.
    await act(async () => {
      shareButton.click();
    });
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/b/${VALID}`);
  });

  it('clears a pending retry timer on unmount (no stray check)', async () => {
    vi.useFakeTimers();
    api.check = () => Promise.resolve({ kind: 'unreachable' });
    const { unmount } = render(<BoardPage id={VALID} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.checkCalls).toBe(1);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    // The unmounted page scheduled no further retries.
    expect(api.checkCalls).toBe(1);
  });
});
