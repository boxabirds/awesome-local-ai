import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharePanel } from '@client/share/SharePanel';
import { boardLink } from '@client/share/board-link';

describe('share.share_panel component tests', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // TC-22: writeText resolves; "Link copied" at LINK_COPIED_MS-1, reverted at LINK_COPIED_MS
  describe('TC-22: Copy link with clipboard success', () => {
    it('copies link and shows confirmation for LINK_COPIED_MS', async () => {
      vi.useFakeTimers();
      render(React.createElement(SharePanel, { boardId: 'abcdefghijklmnopqrstuv' }));

      // Open panel
      const shareBtn = screen.getByRole('button', { name: /^share$/i });
      fireEvent.click(shareBtn);
      expect(screen.getByRole('dialog')).toBeDefined();

      // Click Copy link
      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      fireEvent.click(copyBtn);

      // Clipboard was called with the full link (fireEvent is sync so call is already made)
      const expectedLink = `${window.location.origin}/b/abcdefghijklmnopqrstuv`;
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink);

      // Advance timers to flush the microtask queue (writeText mock resolves as microtask)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Button shows "Link copied"
      expect(screen.getByText(/link copied/i)).toBeDefined();

      // At LINK_COPIED_MS - 1 (1999ms), still shows copied
      await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
      expect(screen.getByText(/link copied/i)).toBeDefined();

      // At exactly LINK_COPIED_MS total (another 1ms), reverted
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByText(/copy link/i)).toBeDefined();
    });
  });

  // TC-23: writeText rejects → input fully selected, manual-copy message
  describe('TC-23: Clipboard rejected → manual copy', () => {
    it('shows manual copy message when writeText rejects', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        writable: true,
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: 'abcdefghijklmnopqrstuv' }));

      const shareBtn = screen.getByRole('button', { name: /^share$/i });
      await userEvent.click(shareBtn);

      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      await userEvent.click(copyBtn);

      await waitFor(() => {
        expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
      });

      // Input is selected
      const input = screen.getByLabelText('Board link') as HTMLInputElement;
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });
  });

  // TC-24: navigator.clipboard undefined → same as TC-23
  describe('TC-24: Missing clipboard API → manual copy', () => {
    it('shows manual copy message when clipboard is undefined', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: 'abcdefghijklmnopqrstuv' }));

      const shareBtn = screen.getByRole('button', { name: /^share$/i });
      await userEvent.click(shareBtn);

      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      await userEvent.click(copyBtn);

      await waitFor(() => {
        expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
      });
    });
  });

  // TC-25: Escape closes; outside click closes; focus returns to Share button
  describe('TC-25: Panel close behaviour', () => {
    it('closes on Escape', async () => {
      render(React.createElement(SharePanel, { boardId: 'abcdefghijklmnopqrstuv' }));

      const shareBtn = screen.getByRole('button', { name: /^share$/i });
      await userEvent.click(shareBtn);
      expect(screen.getByRole('dialog')).toBeDefined();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes on outside click', async () => {
      render(
        React.createElement('div', { id: 'root-wrapper' },
          React.createElement('div', { 'data-testid': 'outside', style: { width: 200, height: 200, position: 'absolute', top: 0, left: 0 } }, 'outside content'),
          React.createElement(SharePanel, { boardId: 'abcdefghijklmnopqrstuv' }),
        ),
      );

      const shareBtn = screen.getByRole('button', { name: /^share$/i });
      await userEvent.click(shareBtn);
      expect(screen.getByRole('dialog')).toBeDefined();

      // Fire mousedown directly on the outside element
      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside, { bubbles: true });

      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // boardLink utility
  describe('boardLink utility', () => {
    it('constructs the correct link', () => {
      expect(boardLink('https://example.com', 'abc123')).toBe('https://example.com/b/abc123');
    });
  });
});
