import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const BOARD_ID = 'abcdefghijklmnopqrstuvwx';

describe('TC-22: Copy link with clipboard success', () => {
  it('writeText called with full link; "Link copied" at LINK_COPIED_MS - 1, reverts at LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<SharePanel boardId={BOARD_ID} />);

    // Open panel
    fireEvent.click(screen.getByTestId('share-btn'));
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    // Click Copy link
    fireEvent.click(screen.getByTestId('copy-link-btn'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/b/${BOARD_ID}`);
    expect(screen.getByTestId('copy-link-btn')).toHaveTextContent('Link copied');

    // At LINK_COPIED_MS - 1, still shows "Link copied"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link-btn')).toHaveTextContent('Link copied');

    // At exactly LINK_COPIED_MS, reverts
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('copy-link-btn')).toHaveTextContent('Copy link');
  });
});

describe('TC-23: Copy link with clipboard rejection → manual copy', () => {
  it('writeText rejects → input selected, manual-copy message shown', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-btn'));
    fireEvent.click(screen.getByTestId('copy-link-btn'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('manual-copy-msg')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );

    // Input should be selected
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('TC-24: Clipboard API missing → manual copy', () => {
  it('navigator.clipboard undefined → manual-copy message', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-btn'));
    fireEvent.click(screen.getByTestId('copy-link-btn'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('manual-copy-msg')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
  });
});

describe('TC-25: Panel closes on Escape and outside click; focus returns to Share button', () => {
  it('Escape closes panel, focus returns to Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    const shareBtn = screen.getByTestId('share-btn');
    fireEvent.click(shareBtn);
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(shareBtn);
  });

  it('outside pointerdown closes panel, focus returns to Share button', () => {
    render(
      <div>
        <SharePanel boardId={BOARD_ID} />
        <div data-testid="outside">outside</div>
      </div>,
    );
    const shareBtn = screen.getByTestId('share-btn');
    fireEvent.click(shareBtn);
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(shareBtn);
  });
});

describe('boardLink utility', () => {
  it('constructs correct URL', () => {
    expect(boardLink('https://example.com', 'abc123')).toBe('https://example.com/b/abc123');
  });
});
