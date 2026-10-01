// @vitest-environment jsdom
// tests/component/SharePanel.test.tsx
// Component tests for the Share panel (TC-22 to TC-25).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

describe('share.share_panel: SharePanel (TC-22 to TC-25)', () => {
  const boardId = newBoardId();

  beforeEach(() => {
    vi.useFakeTimers();
    // Navigate to the board path so window.location.origin is set
    window.history.pushState(null, '', `/b/${boardId}`);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    // Reset to root
    window.history.pushState(null, '', '/');
  });

  // TC-22: writeText resolves → "Link copied" visible at LINK_COPIED_MS - 1, reverted at LINK_COPIED_MS
  it('TC-22: copy link shows "Link copied" then reverts', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    // Open the panel
    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    // Panel should be open
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();

    // Click Copy link
    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    act(() => {
      fireEvent.click(copyBtn);
    });

    // Wait for the async writeText to resolve
    await act(async () => {
      await Promise.resolve();
    });

    // writeText should have been called with the full link
    const expectedLink = `${window.location.origin}/b/${boardId}`;
    expect(writeTextMock).toHaveBeenCalledWith(expectedLink);

    // "Link copied" should be visible
    expect(screen.getByText('✓ Link copied')).toBeTruthy();

    // At LINK_COPIED_MS - 1, still showing "Link copied"
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByText('✓ Link copied')).toBeTruthy();

    // At exactly LINK_COPIED_MS, should revert to "Copy link"
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  // TC-23: writeText rejects → input fully selected, manual-copy message
  it('TC-23: clipboard rejection shows manual copy message', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    act(() => {
      fireEvent.click(copyBtn);
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Manual copy message should be visible
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();

    // The input should be selected
    const input = screen.getByDisplayValue(`${window.location.origin}/b/${boardId}`) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  // TC-24: navigator.clipboard undefined → same as TC-23
  it('TC-24: missing clipboard API shows manual copy message', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    act(() => {
      fireEvent.click(copyBtn);
    });

    await act(async () => {
      await Promise.resolve();
    });

    // Manual copy message should be visible
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
  });

  // TC-25: Escape closes; outside click closes; focus returns to Share button
  it('TC-25a: Escape closes the panel', () => {
    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
  });

  it('TC-25b: outside click closes the panel', () => {
    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();

    // Click outside
    act(() => {
      fireEvent.pointerDown(document.body);
    });

    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
  });

  it('TC-25c: focus returns to Share button on close', () => {
    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    act(() => {
      fireEvent.click(shareBtn);
    });

    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    // Focus should be back on the Share button
    expect(document.activeElement).toBe(shareBtn);
  });
});

describe('share.share_panel: boardLink helper', () => {
  it('produces the correct link format', () => {
    expect(boardLink('https://example.com', 'abc123')).toBe('https://example.com/b/abc123');
  });
});
