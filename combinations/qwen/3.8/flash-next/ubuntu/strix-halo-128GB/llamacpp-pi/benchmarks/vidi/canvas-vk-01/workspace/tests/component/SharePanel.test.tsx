import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

/**
 * Component tests for share.share_panel (TC-22 to TC-25).
 * Clipboard is stubbed; fake timers drive LINK_COPIED_MS.
 */

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

describe('boardLink', () => {
  it('builds the correct link', () => {
    expect(boardLink('https://vidi6.example.com', 'abcdefghijklmnopqrstuv')).toBe(
      'https://vidi6.example.com/b/abcdefghijklmnopqrstuv',
    );
  });
});

describe('SharePanel', () => {
  const boardId = 'abcdefghijklmnopqrstuv';
  const link = `${window.location.origin}/b/${boardId}`;

  it('TC-22: writeText resolves with full link; "Link copied" at LINK_COPIED_MS−1, reverted at LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    // Click Share to open panel
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });

    // Click Copy link
    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByText(/Link copied/)).toBeDefined();

    // At LINK_COPIED_MS - 1, still shows "Link copied"
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByText(/Link copied/)).toBeDefined();

    // At exactly LINK_COPIED_MS, reverts to "Copy link"
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Copy link')).toBeDefined();
    expect(screen.queryByText(/Link copied/)).toBeNull();
  });

  it('TC-23: writeText rejects → input fully selected, manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
    const input = screen.getByLabelText('Board link') as HTMLInputElement;
    expect(input.value).toBe(link);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-24: navigator.clipboard undefined → same as TC-23', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
    const input = screen.getByLabelText('Board link') as HTMLInputElement;
    expect(input.value).toBe(link);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-25: Escape closes; outside click closes; focus returns to Share button', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    const shareButton = screen.getByRole('button', { name: 'Share' });

    // Open panel
    await act(async () => {
      fireEvent.click(shareButton);
    });
    expect(screen.getByRole('dialog')).toBeDefined();

    // Escape closes
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shareButton).toBe(document.activeElement);

    // Open again
    await act(async () => {
      fireEvent.click(shareButton);
    });
    expect(screen.getByRole('dialog')).toBeDefined();

    // Outside click closes
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shareButton).toBe(document.activeElement);
  });
});
