/**
 * Component tests for SharePanel (TC-22 to TC-25).
 * Uses stubbed clipboard and fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel } from '../../src/client/share/SharePanel';

const BOARD_ID = 'abcdefghijklmnopqrstuv';

describe('share.share_panel', () => {
  let originalClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as any).clipboard;
    }
    vi.restoreAllMocks();
  });

  // TC-22: writeText resolves → "Link copied" visible at LINK_COPIED_MS - 1, reverted at LINK_COPIED_MS
  describe('TC-22: copy link shows "Link copied" for LINK_COPIED_MS', () => {
    it('shows Link copied after copy, reverts after timeout', async () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: BOARD_ID }));

      // Click share button to open panel
      const shareBtn = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareBtn);

      // Panel should be open
      expect(screen.getByRole('dialog', { name: /share board/i })).toBeInTheDocument();

      // Click "Copy link" button
      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      fireEvent.click(copyBtn);

      // Flush the promise from writeText
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      // "Link copied" should be visible
      expect(screen.getByText(/link copied/i)).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/b/${BOARD_ID}`));

      // Advance to just before LINK_COPIED_MS - button should still show "Link copied"
      await act(async () => {
        vi.advanceTimersByTime(LINK_COPIED_MS - 1);
      });
      expect(screen.getByText(/link copied/i)).toBeInTheDocument();

      // Advance to LINK_COPIED_MS - should revert
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText(/link copied/i)).not.toBeInTheDocument();
      // Should show "Copy link" again
      expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  // TC-23: writeText rejects → input selected, manual-copy message
  describe('TC-23: clipboard rejects shows manual-copy message', () => {
    it('writeText rejects → manual copy message shown', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: BOARD_ID }));

      // Open panel
      const shareBtn = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareBtn);

      expect(screen.getByRole('dialog', { name: /share board/i })).toBeInTheDocument();

      // Click Copy link
      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      // Should show manual copy message
      await waitFor(() => {
        expect(screen.getByText(/press ctrl\+c/i)).toBeInTheDocument();
      });

      // The input should contain the full link
      const input = screen.getByRole('textbox');
      expect((input as HTMLInputElement).value).toContain(`/b/${BOARD_ID}`);
    });
  });

  // TC-24: navigator.clipboard undefined → same as TC-23
  describe('TC-24: no clipboard API → manual copy message', () => {
    it('clipboard undefined → manual copy message', async () => {
      delete (navigator as any).clipboard;

      render(React.createElement(SharePanel, { boardId: BOARD_ID }));

      // Open panel
      const shareBtn = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareBtn);

      expect(screen.getByRole('dialog', { name: /share board/i })).toBeInTheDocument();

      // Click Copy link
      const copyBtn = screen.getByRole('button', { name: /copy link/i });
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      // Should show manual copy message
      await waitFor(() => {
        expect(screen.getByText(/press ctrl\+c/i)).toBeInTheDocument();
      });
    });
  });

  // TC-25: Escape closes; outside click closes; focus returns to Share button
  describe('TC-25: Escape and outside click close panel', () => {
    it('Escape closes panel and focuses Share button', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: BOARD_ID }));

      const shareBtn = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareBtn);

      expect(screen.getByRole('dialog', { name: /share board/i })).toBeInTheDocument();

      // Press Escape
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('dialog', { name: /share board/i })).not.toBeInTheDocument();

      // Focus should return to share button
      expect(document.activeElement).toBe(shareBtn);
    });

    it('outside click closes panel', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });

      render(React.createElement(SharePanel, { boardId: BOARD_ID }));

      const shareBtn = screen.getByRole('button', { name: /share/i });
      fireEvent.click(shareBtn);

      expect(screen.getByRole('dialog', { name: /share board/i })).toBeInTheDocument();

      // Click outside - use pointerdown on a div outside the panel
      fireEvent.pointerDown(document.body);

      expect(screen.queryByRole('dialog', { name: /share board/i })).not.toBeInTheDocument();
    });
  });
});
