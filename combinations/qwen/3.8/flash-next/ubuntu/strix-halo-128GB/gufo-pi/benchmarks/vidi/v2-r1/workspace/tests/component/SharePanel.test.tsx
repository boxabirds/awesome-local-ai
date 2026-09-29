/**
 * Component tests for SharePanel (story 5).
 * TC-22 to TC-25.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const BOARD_ID = 'abcdefghijklmnopqrstuv';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('boardLink', () => {
  it('constructs correct link', () => {
    expect(boardLink('https://example.com', BOARD_ID)).toBe(`https://example.com/b/${BOARD_ID}`);
  });
});

describe('SharePanel (TC-22 to TC-25)', () => {
  // TC-22: clipboard writeText resolves → "Link copied" for LINK_COPIED_MS, then reverts
  it('TC-22: copy link shows confirmation for LINK_COPIED_MS boundary', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeDefined();

    fireEvent.click(screen.getByTestId('copy-link'));

    // Flush async writeText promise
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(`/b/${BOARD_ID}`);

    // At LINK_COPIED_MS - 1, still shows "Link copied"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link').textContent).toContain('Link copied');

    // At exactly LINK_COPIED_MS, reverts to "Copy link"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('copy-link').textContent).toBe('Copy link');

    vi.useRealTimers();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  });

  // TC-23: writeText rejects → input fully selected, manual-copy message
  it('TC-23: clipboard rejected shows manual copy message and selects input', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('copy-link'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const msg = screen.getByTestId('manual-copy-msg');
    expect(msg.textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');

    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(input).toBe(document.activeElement);
    // Selection should cover the entire value
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
  });

  // TC-24: navigator.clipboard undefined → same as TC-23
  it('TC-24: missing clipboard API shows manual copy message', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('copy-link'));

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const msg = screen.getByTestId('manual-copy-msg');
    expect(msg.textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');

    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(input).toBe(document.activeElement);
  });

  // TC-25: Escape closes panel, outside pointerdown closes panel, focus returns to Share button
  it('TC-25: Escape and outside pointerdown close the panel', async () => {
    render(<SharePanel boardId={BOARD_ID} />);

    // Open panel
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeDefined();

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();

    // Re-open
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeDefined();

    // Outside pointerdown closes
    fireEvent(document.body, new PointerEvent('pointerdown', { bubbles: true }));
    expect(screen.queryByTestId('share-panel')).toBeNull();

    // Focus is back on Share button
    expect(screen.getByTestId('share-button')).toBe(document.activeElement);
  });
});
