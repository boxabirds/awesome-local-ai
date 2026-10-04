import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'validboardid1234567890123';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('boardLink', () => {
  it('produces the correct link', () => {
    expect(boardLink('https://example.com', BOARD_ID)).toBe(
      `https://example.com/b/${BOARD_ID}`,
    );
  });
});

describe('TC-22: writeText resolves → "Link copied" visible then reverts', () => {
  it('shows "Link copied" for LINK_COPIED_MS then reverts', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    // Open the panel
    const shareBtn = screen.getByTestId('share-button');
    act(() => {
      fireEvent.click(shareBtn);
    });

    // Panel is open
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Click Copy link
    const copyBtn = screen.getByTestId('copy-link-button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // writeText called with full link
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/b/${BOARD_ID}`,
    );

    // "Link copied" is visible
    expect(copyBtn.textContent).toContain('Link copied');

    // At LINK_COPIED_MS - 1, still visible
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copyBtn.textContent).toContain('Link copied');

    // At exactly LINK_COPIED_MS, reverts
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(copyBtn.textContent).toBe('Copy link');
  });
});

describe('TC-23: writeText rejects → manual copy message', () => {
  it('shows manual copy message and selects input', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    const shareBtn = screen.getByTestId('share-button');
    act(() => {
      fireEvent.click(shareBtn);
    });

    const copyBtn = screen.getByTestId('copy-link-button');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    // Manual copy message appears
    const msg = screen.getByTestId('manual-copy-message');
    expect(msg.textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');

    // Input is selected
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('TC-24: navigator.clipboard undefined → same as TC-23', () => {
  it('shows manual copy message when clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    const shareBtn = screen.getByTestId('share-button');
    act(() => {
      fireEvent.click(shareBtn);
    });

    const copyBtn = screen.getByTestId('copy-link-button');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    const msg = screen.getByTestId('manual-copy-message');
    expect(msg.textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
  });
});

describe('TC-25: Escape closes; outside click closes; focus returns to Share button', () => {
  it('closes on Escape and returns focus to Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);

    const shareBtn = screen.getByTestId('share-button');
    act(() => {
      fireEvent.click(shareBtn);
    });

    // Panel is open
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Panel is closed
    expect(screen.queryByTestId('share-panel')).toBeNull();

    // Focus is back on the Share button
    expect(document.activeElement).toBe(shareBtn);
  });

  it('closes on outside click', () => {
    const { container } = render(<SharePanel boardId={BOARD_ID} />);

    const shareBtn = screen.getByTestId('share-button');
    act(() => {
      fireEvent.click(shareBtn);
    });

    // Panel is open
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Click outside
    const outsideEl = document.createElement('div');
    container.appendChild(outsideEl);
    act(() => {
      fireEvent.pointerDown(outsideEl);
    });

    // Panel is closed
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });
});
