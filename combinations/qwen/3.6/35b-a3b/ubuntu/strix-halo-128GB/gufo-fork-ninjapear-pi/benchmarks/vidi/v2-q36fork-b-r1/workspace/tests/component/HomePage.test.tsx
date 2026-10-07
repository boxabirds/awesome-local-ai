/**
 * Task 6: Component tests for HomePage (TC-16, TC-17).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HomePage } from '@/client/pages/HomePage';

// Use module factory pattern to avoid hoisting issues
const navigateMock = vi.fn();

vi.mock('@/client/api', () => ({
  createBoardRequest: vi.fn(),
}));

vi.mock('@/client/router', () => ({
  useRoute: () => ({ name: 'home' }),
  navigate: navigateMock,
}));

const { createBoardRequest } = await import('@/client/api');

describe('HomePage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---- TC-16: New board button triggers creating state then navigation ----
  it('TC-16: click New board → "Creating…" disabled → navigates to /b/<id>', async () => {
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'created', id: 'abc123def456ghi789jklm' });

    render(<HomePage />);

    const btn = screen.getByTestId('new-board-btn');
    expect(btn.textContent).toBe('New board');
    expect(btn).not.toBeDisabled();

    // Click → creates
    fireEvent.click(btn);
    expect(btn.textContent).toBe('Creating…');
    expect(btn).toBeDisabled();

    // Flush pending microtasks (await resolved promise runs as macro-task)
    vi.runOnlyPendingTimers();
    vi.runAllTimers();

    // Wait for navigation after promise resolves
    await new Promise(r => setTimeout(r, 0));

    expect(navigateMock).toHaveBeenCalledWith('/b/abc123def456ghi789jklm');
  });

  // ---- TC-17: API failure keeps user on home with error message ----
  it('TC-17a: network error → exact failure message, button re-enabled, no nav', async () => {
    vi.mocked(createBoardRequest).mockRejectedValue(new Error('network'));

    render(<HomePage />);

    fireEvent.click(screen.getByTestId('new-board-btn'));
    vi.runAllTimers();
    await new Promise(r => setTimeout(r, 0));

    const msg = screen.getByTestId('creation-error');
    expect(msg).toHaveTextContent("Couldn't create a board. Please try again.");

    // Button re-enabled
    const btn = screen.getByTestId('new-board-btn');
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toBe("Couldn't create a board. Please try again.");

    // Did NOT navigate
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('TC-17b: 500 response (kind:failed) → same failure message', async () => {
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    fireEvent.click(screen.getByTestId('new-board-btn'));
    vi.runAllTimers();
    await new Promise(r => setTimeout(r, 0));

    const msg = screen.getByTestId('creation-error');
    expect(msg).toHaveTextContent("Couldn't create a board. Please try again.");

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
