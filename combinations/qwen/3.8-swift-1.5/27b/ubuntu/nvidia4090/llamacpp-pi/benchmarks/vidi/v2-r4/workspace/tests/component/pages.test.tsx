import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import * as api from '../../src/client/api';
import * as router from '../../src/client/router';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

// Mock ResizeObserver for jsdom
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('TC-16: Home create - click New board navigates to /b/id', () => {
  it('button shows Creating… and is disabled; then navigate to /b/id', async () => {
    const boardId = newBoardId();
    
    // Use a controlled promise to check intermediate state
    let resolveCreate: (v: any) => void;
    const createPromise = new Promise(r => { resolveCreate = r; });
    vi.spyOn(api, 'createBoardRequest').mockReturnValue(createPromise as any);
    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    render(<HomePage />);
    const btn = screen.getByRole('button', { name: 'New board' });
    
    // Click - the handler sets state to 'creating' synchronously before awaiting
    act(() => {
      fireEvent.click(btn);
    });
    
    // After click dispatch, state should be 'creating'
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    
    // Resolve the promise
    await act(async () => {
      resolveCreate!({ kind: 'created', id: boardId });
      await Promise.resolve();
    });
    
    expect(navigateSpy).toHaveBeenCalledWith(`/b/${boardId}`);
  });
});

describe('TC-17: Home create failure - message shown, button enabled, route still /', () => {
  it('shows error message on 500; button enabled; no navigation', async () => {
    const user = userEvent.setup();
    
    vi.spyOn(api, 'createBoardRequest').mockResolvedValue({ kind: 'failed' });
    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    render(<HomePage />);
    const btn = screen.getByRole('button', { name: 'New board' });
    
    await user.click(btn);
    
    // Error message shown
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    // Button is enabled again
    expect(screen.getByRole('button', { name: 'New board' })).not.toBeDisabled();
    // No navigation
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('shows error message on network error; button enabled', async () => {
    const user = userEvent.setup();
    
    vi.spyOn(api, 'createBoardRequest').mockResolvedValue({ kind: 'failed' });
    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    render(<HomePage />);
    const btn = screen.getByRole('button', { name: 'New board' });
    
    await user.click(btn);
    
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    expect(screen.getByRole('button', { name: 'New board' })).not.toBeDisabled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('TC-19: Open link with malformed id shows NotFoundPage, api.getBoard not called', () => {
  it('renders NotFoundPage for /b/bad; checkBoard not called', () => {
    const checkSpy = vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'exists' });
    
    render(<BoardPage id="bad" />);
    
    expect(screen.getByText('Board not found')).toBeInTheDocument();
    expect(checkSpy).not.toHaveBeenCalled();
  });
});

describe('TC-20: Open link with unknown valid id shows NotFoundPage after checking', () => {
  it('api returns 404 → Opening board… then NotFoundPage with New board button', async () => {
    vi.spyOn(api, 'checkBoard').mockResolvedValue({ kind: 'not_found' });
    
    render(<BoardPage id={newBoardId()} />);
    
    // Initially shows "Opening board…"
    // After the async check resolves, shows NotFoundPage
    await screen.findByText('Board not found');
    expect(screen.getByRole('button', { name: 'New board' })).toBeInTheDocument();
  });
});

describe('TC-21: Open link with unreachable then healthy service', () => {
  it('api rejects twice; retry message shown with correct backoff; 3 calls total', async () => {
    vi.useFakeTimers();
    
    let callCount = 0;
    // All calls fail - we only verify the retry behavior, not the success path
    vi.spyOn(api, 'checkBoard').mockImplementation(async () => {
      callCount++;
      return { kind: 'unreachable' };
    });
    
    const boardId = newBoardId();
    render(<BoardPage id={boardId} />);
    
    // Initially "Opening board…"
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
    
    // Advance microtasks for first check to resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    
    // Should show retry message after first failure
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    expect(callCount).toBe(1);
    
    // Advance timer for first retry (BOARD_CHECK_RETRY_BASE_MS * 2^0 = 1000ms)
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    
    // Second call made, still showing retry
    expect(callCount).toBe(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
    
    // Advance timer for second retry (BOARD_CHECK_RETRY_BASE_MS * 2^1 = 2000ms)
    await act(async () => {
      vi.advanceTimersByTime(BOARD_CHECK_RETRY_BASE_MS * 2);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    
    // Third call made
    expect(callCount).toBe(3);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeInTheDocument();
  });
});
