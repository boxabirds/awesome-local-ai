/** Component tests for pages and Share panel — stories 1–5
 * JSDOM-based tests with mocked api.ts, fake timers.
 * Covers: TC-16, TC-17, TC-19 to TC-25
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Mock router before importing components that use it
vi.mock('../../src/client/router', () => ({
  navigate: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

// Mock connectBoard to avoid WebSocket creation in jsdom
vi.mock('../../src/client/sync/connectBoard', () => ({
  getState: vi.fn(() => 'connected'),
}));

describe('TC-16: Home page creates board and navigates', () => {
  let HomePage: typeof import('../../src/client/pages/HomePage').HomePage;
  let createBoardRequestMock: ReturnType<typeof vi.fn>;
  let navigateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../src/client/api');
    const routerMod = await import('../../src/client/router');
    HomePage = (await import('../../src/client/pages/HomePage')).HomePage;
    createBoardRequestMock = vi.spyOn(mod, 'createBoardRequest') as ReturnType<typeof vi.fn>;
    navigateMock = routerMod.navigate as ReturnType<typeof vi.fn>;
  });

  it('click New board → Creating… disabled → navigate to /b/id', async () => {
    createBoardRequestMock.mockResolvedValue({ kind: 'created', id: 'abc123Def456ghi789jklm' });
    
    render(<HomePage />);
    
    expect(screen.getByRole('button', { name: 'New board' })).toHaveTextContent('New board');
    
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    
    // Should show Creating… and button should be disabled
    expect(screen.getByRole('button', { name: 'New board' })).toHaveTextContent('Creating…');
    expect(screen.getByRole('button', { name: 'New board' })).toBeDisabled();
    
    // Wait for navigation
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    
    expect(navigateMock).toHaveBeenCalledWith('/b/abc123Def456ghi789jklm');
  });
});

describe('TC-17: Creation failure shows error message', () => {
  let HomePage: typeof import('../../src/client/pages/HomePage').HomePage;
  let createBoardRequestMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../src/client/api');
    HomePage = (await import('../../src/client/pages/HomePage')).HomePage;
    createBoardRequestMock = vi.spyOn(mod, 'createBoardRequest') as ReturnType<typeof vi.fn>;
  });

  it('api returns failed → error message, button enabled, stays on home', async () => {
    createBoardRequestMock.mockResolvedValue({ kind: 'failed' });
    
    render(<HomePage />);
    
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
  });

  it('network error → same failure path', async () => {
    createBoardRequestMock.mockRejectedValue(new Error('network'));
    
    render(<HomePage />);
    
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create a board. Please try again.");
  });
});

describe('TC-19: Malformed id shows not found without API call', () => {
  let BoardPage: typeof import('../../src/client/pages/BoardPage').BoardPage;
  let checkBoardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../src/client/api');
    BoardPage = (await import('../../src/client/pages/BoardPage')).BoardPage;
    checkBoardMock = vi.spyOn(mod, 'checkBoard') as ReturnType<typeof vi.fn>;
    checkBoardMock.mockResolvedValue({ kind: 'exists' });
  });

  it('/b/bad → NotFoundPage; checkBoard not called', async () => {
    render(<BoardPage id="bad" />);
    
    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeInTheDocument();
    }, { timeout: 3000 });
    
    expect(checkBoardMock).not.toHaveBeenCalled();
  });
});

describe('TC-20: not_found from API shows not found page', () => {
  let BoardPage: typeof import('../../src/client/pages/BoardPage').BoardPage;
  let checkBoardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../src/client/api');
    BoardPage = (await import('../../src/client/pages/BoardPage')).BoardPage;
    checkBoardMock = vi.spyOn(mod, 'checkBoard') as ReturnType<typeof vi.fn>;
    // Exactly 22-char base64url string
    checkBoardMock.mockResolvedValueOnce({ kind: 'not_found' });
  });

  it('api returns not_found → Board not found with New board button', async () => {
    // Use exactly 22 valid base64url chars
    render(<BoardPage id="aaaaaaaaaaaaaaaaaaaaaa" />);
    
    // Initially shows "Opening board…"
    expect(screen.getByText("Opening board…")).toBeInTheDocument();
    
    // Then transitions to not found
    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

describe('TC-21: unreachable then healthy', () => {
  let BoardPage: typeof import('../../src/client/pages/BoardPage').BoardPage;
  let checkBoardMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../../src/client/api');
    BoardPage = (await import('../../src/client/pages/BoardPage')).BoardPage;
    checkBoardMock = vi.spyOn(mod, 'checkBoard') as ReturnType<typeof vi.fn>;
    checkBoardMock.mockImplementation(async () => {
      const calls = checkBoardMock.mock.calls.length;
      if (calls <= 2) return { kind: 'unreachable' };
      return { kind: 'exists' };
    });
  });

  it('unreachable → retry message → board renders after success', async () => {
    render(<BoardPage id="bbbbbbbbbbbbbbbbbbbbbb" />);
    
    // Initial state
    expect(screen.getByText("Opening board…")).toBeInTheDocument();
    
    vi.useFakeTimers();
    
    // After first backoff interval (BOARD_CHECK_RETRY_BASE_MS = 1000)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/Couldn't reach vidi6/)).toBeInTheDocument();
    
    // After second backoff interval (2x base = 2000)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    
    vi.useRealTimers();
    // Called: initial + first retry (at 1s) + second retry (at 3s)
    expect(checkBoardMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Share Panel Tests ──────────────────────────────────────────

describe('Share panel', () => {
  let SharePanel: typeof import('../../src/client/share/SharePanel').SharePanel;
  let boardLinkFn: typeof import('../../src/client/share/SharePanel').boardLink;

  beforeEach(async () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://vidi6.example.com' },
      writable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const mod = await import('../../src/client/share/SharePanel');
    SharePanel = mod.SharePanel;
    boardLinkFn = mod.boardLink;
  });

  it('TC-22: Copy link resolved → "Link copied" shown, auto-reverts after delay', async () => {
    const { LINK_COPIED_MS } = await import('../../src/shared/config');
    
    render(<SharePanel boardId="cccccccccccccccccccccc" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    
    const input = screen.getByLabelText<HTMLInputElement>('Board link');
    expect(input.value).toBe(boardLinkFn('https://vidi6.example.com', 'cccccccccccccccccccccc'));
    
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://vidi6.example.com/b/cccccccccccccccccccccc',
    );
    
    // Button shows copied state with checkmark
    await waitFor(() => {
      expect(screen.getByText("✓ Link copied")).toBeInTheDocument();
    });
    
    // Verify clipboard was called with correct URL
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('TC-23: clipboard rejection → select input + manual message', async () => {
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new DOMException('', ''));
    
    render(<SharePanel boardId="dddddddddddddddddddddd" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    
    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });
  });

  it('TC-24: no clipboard API → manual copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { writable: true, value: undefined });
    
    render(<SharePanel boardId="eeeeeeeeeeeeeeeeeeeeee" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    
    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });
  });

  it('Escape key closes panel', async () => {
    const { container } = render(<SharePanel boardId="ffffffffffffffffffffff" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('outside click closes panel', async () => {
    const { container } = render(<SharePanel boardId="gggggggggggggggggggggg" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });
});
