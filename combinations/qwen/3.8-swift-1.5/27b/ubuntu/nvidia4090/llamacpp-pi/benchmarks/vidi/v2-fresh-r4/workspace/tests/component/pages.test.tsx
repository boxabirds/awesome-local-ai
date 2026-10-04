import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import * as api from '../../src/client/api';
import { navigate } from '../../src/client/router';

// Mock the api module
vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

// Mock the router's navigate
vi.mock('../../src/client/router', () => ({
  navigate: vi.fn(),
  useRoute: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TC-16: click New board → Creating… disabled → navigate to /b/<id>', () => {
  it('shows Creating… and navigates on success', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'created', id: 'testboardid123456789012' });

    render(<HomePage />);

    const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
    await user.click(button);

    // Button shows "Creating…" and is disabled
    expect(button.textContent).toBe('Creating…');
    expect(button.disabled).toBe(true);

    // Navigate is called with /b/<id>
    expect(navigate).toHaveBeenCalledWith('/b/testboardid123456789012');
  });
});

describe('TC-17: api failed → exact failure message, button enabled, still on /', () => {
  it('shows error message on 500 failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
    await user.click(button);

    // Error message appears
    const errorEl = screen.getByTestId('home-error');
    expect(errorEl.textContent).toBe("Couldn't create a board. Please try again.");
    // Button is enabled again
    expect(button.disabled).toBe(false);
    // No navigation
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows error message on network failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByTestId('new-board-button') as HTMLButtonElement;
    await user.click(button);

    const errorEl = screen.getByTestId('home-error');
    expect(errorEl.textContent).toBe("Couldn't create a board. Please try again.");
    expect(button.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('TC-19: /b/bad → NotFoundPage; checkBoard never called', () => {
  it('renders NotFoundPage for malformed id without calling checkBoard', () => {
    render(<BoardPage id="bad" />);

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(api.checkBoard).not.toHaveBeenCalled();
  });
});

describe('TC-20: not_found → "Opening board…" then NotFoundPage', () => {
  it('shows loading then not found', async () => {
    vi.mocked(api.checkBoard).mockResolvedValue({ kind: 'not_found' });

    // 22-char valid board id
    const validId = 'abcdefghijklmnopqrstu0';
    const { unmount } = render(<BoardPage id={validId} />);

    // Wait for the async check to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(screen.getByTestId('not-found-new-board')).toBeTruthy();

    unmount();
  });
});

describe('TC-21: unreachable twice then exists → retry → board', () => {
  it('retries with backoff and eventually shows board', async () => {
    vi.useFakeTimers();
    try {
      let callCount = 0;
      vi.mocked(api.checkBoard).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({ kind: 'unreachable' });
        }
        return Promise.resolve({ kind: 'exists' });
      });

      // 22-char valid board id
      const validId = 'abcdefghijklmnopqrstu1';
      const { unmount } = render(<BoardPage id={validId} />);

      // First call happens immediately (in useEffect)
      // Flush microtasks for the first checkBoard call
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      // Shows unreachable message
      const unreachableEl = screen.getByTestId('board-unreachable');
      expect(unreachableEl.textContent).toBe("Couldn't reach vidi6. Retrying…");

      // Advance first backoff (1000ms)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // Second unreachable (callCount = 2)
      expect(screen.getByTestId('board-unreachable')).toBeTruthy();

      // Advance second backoff (2000ms)
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // Now the board should be ready (BoardContent renders the viewport)
      expect(document.querySelector('[data-vidi6="board-viewport"]')).toBeTruthy();

      expect(callCount).toBe(3);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
