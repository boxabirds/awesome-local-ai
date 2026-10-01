// Story 5, client.story5_share_link (TC-19): the three routes, driven through the
// real `App` and a mocked `api.ts`. The router reads the address and re-renders on
// Back / Forward; a board address asks the service, a home address is the Home
// page, and everything else is the Board-not-found page. The half of TC-19 that
// is a pure function (which page an address names) is also checked with no DOM in
// `tests/unit/router.test.ts`.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { checkBoard } from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' as const })),
  checkBoard: vi.fn(async () => ({ kind: 'exists' as const })),
}));

const mockedCheck = vi.mocked(checkBoard);

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('TC-19: the three routes', () => {
  it('the root is the Home page', () => {
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('a board address asks the service and shows the board', async () => {
    const id = newBoardId();
    window.history.replaceState({}, '', `/b/${id}`);
    mockedCheck.mockResolvedValue({ kind: 'exists' });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('sticky-note-button')).toBeTruthy());
    expect(mockedCheck).toHaveBeenCalledWith(id);
  });

  it('an unknown path is the Board-not-found page, with no request sent', () => {
    window.history.replaceState({}, '', '/made/up/thing');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it('a malformed board address is not-found with no request sent', () => {
    // The id after `/b/` is too short to be an id, so the router never sends a
    // request for it — which is also TC-20, checked again in BoardPage.test.tsx.
    window.history.replaceState({}, '', '/b/short');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Board not found' })).toBeTruthy();
    expect(mockedCheck).not.toHaveBeenCalled();
  });
});

describe('TC-19: navigation and the history', () => {
  it('Back (popstate) re-reads the address', async () => {
    const id = newBoardId();
    window.history.replaceState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    // Go to a board: the page follows the address via popstate, not a re-render.
    window.history.pushState({}, '', `/b/${id}`);
    mockedCheck.mockResolvedValue({ kind: 'exists' });
    fireEvent.popState(window);
    await waitFor(() => expect(screen.getByTestId('sticky-note-button')).toBeTruthy());
    // And back to home.
    window.history.pushState({}, '', '/');
    fireEvent.popState(window);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy());
  });
});
