/**
 * Task 6: Component tests for HomePage (TC-16, TC-17).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

describe('HomePage', () => {
  let navigateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetModules();
    navigateMock = vi.fn();
    
    vi.doMock('@/client/router', () => ({
      useRoute: () => ({ name: 'home' }),
      navigate: navigateMock,
    }));
  });

  afterEach(async () => {
    cleanup();
    await vi.resetModules();
    vi.useRealTimers();
  });

  // ---- TC-16: New board button triggers creating state then navigation ----
  it('TC-16: click New board → "Creating…" disabled → navigates to /b/<id>', async () => {
    vi.doMock('@/client/api', () => ({
      createBoardRequest: vi.fn().mockResolvedValue({ kind: 'created', id: 'abc123def456ghi789jklm' }),
    }));

    const { HomePage } = await import('@/client/pages/HomePage');

    render(<HomePage />);

    const btn = screen.getByTestId('new-board-btn');
    expect(btn.textContent).toBe('New board');
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    expect(btn.textContent).toBe('Creating…');
    expect(btn).toBeDisabled();

    await act(async () => {});

    expect(navigateMock).toHaveBeenCalledWith('/b/abc123def456ghi789jklm');
  });

  // ---- TC-17: API failure keeps user on home with error message ----
  it('TC-17a: network error → exact failure message, button re-enabled, no nav', async () => {
    vi.doMock('@/client/api', () => ({
      createBoardRequest: vi.fn().mockRejectedValue(new Error('network')),
    }));

    const { HomePage } = await import('@/client/pages/HomePage');

    render(<HomePage />);

    fireEvent.click(screen.getByTestId('new-board-btn'));
    
    let btn = screen.getByTestId('new-board-btn');
    expect(btn.textContent).toBe('Creating…');
    
    await act(async () => {});
    
    btn = screen.getByTestId('new-board-btn');
    
    // Error paragraph should appear below the button
    const msg = screen.getByTestId('creation-error');
    expect(msg).toHaveTextContent("Couldn't create a board. Please try again.");
    
    // Button re-enabled with normal text
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).toBe('New board');

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('TC-17b: 500 response (kind:failed) → same failure message', async () => {
    vi.doMock('@/client/api', () => ({
      createBoardRequest: vi.fn().mockResolvedValue({ kind: 'failed' }),
    }));

    const { HomePage } = await import('@/client/pages/HomePage');

    render(<HomePage />);

    fireEvent.click(screen.getByTestId('new-board-btn'));
    expect(screen.getByTestId('new-board-btn').textContent).toBe('Creating…');
    
    await act(async () => {});

    const msg = screen.getByTestId('creation-error');
    expect(msg).toHaveTextContent("Couldn't create a board. Please try again.");

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
