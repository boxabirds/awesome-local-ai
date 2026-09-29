import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { SharePanel, boardLink } from '@client/share/SharePanel';
import { LINK_COPIED_MS } from '@shared/config';

const BOARD_ID = 'c'.repeat(22);
const FULL_LINK = `${window.location.origin}/b/${BOARD_ID}`;

function stubClipboard(writeText: () => Promise<void> | void) {
  vi.stubGlobal(
    'navigator',
    { clipboard: { writeText } },
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TC-22: copy link succeeds (boundary)', () => {
  it('writeText gets the full link; "Link copied" visible at LINK_COPIED_MS − 1, reverted at LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<SharePanel boardId={BOARD_ID} />);

    // Panel opens with the full board link in a read-only field.
    fireEvent.click(screen.getByTestId('share-button'));
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input).toHaveValue(FULL_LINK);
    expect(input).toHaveAttribute('readonly');

    // Copy.
    fireEvent.click(screen.getByTestId('copy-link'));
    await act(async () => {});
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(FULL_LINK);

    // "Link copied" is visible just before the window expires…
    const copied = screen.getByTestId('copy-link');
    expect(copied).toHaveTextContent('Link copied');
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copied).toHaveTextContent('Link copied');

    // …and reverts exactly at LINK_COPIED_MS.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(copied).toHaveTextContent('Copy link');
  });
});

describe('TC-23: writeText rejects → manual copy (error path)', () => {
  it('selects the full link and shows the manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);

    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;

    fireEvent.click(screen.getByTestId('copy-link'));
    await act(async () => {});

    expect(writeText).toHaveBeenCalledWith(FULL_LINK);
    // The full link is selected for a manual copy.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(FULL_LINK.length);
    expect(screen.getByTestId('manual-copy')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    expect(screen.getByTestId('copy-link')).toHaveTextContent('Copy link');
  });
});

describe('TC-24: navigator.clipboard undefined → manual copy (error path)', () => {
  it('selects the link and shows the manual-copy message without calling writeText', async () => {
    // No clipboard API at all.
    vi.stubGlobal('navigator', {});

    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;

    fireEvent.click(screen.getByTestId('copy-link'));
    await act(async () => {});

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(FULL_LINK.length);
    expect(screen.getByTestId('manual-copy')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
  });
});

describe('TC-25: Escape and outside click close; focus returns to Share button', () => {
  it('Escape closes the panel and returns focus to the Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    const shareButton = screen.getByTestId('share-button');

    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(shareButton).toHaveFocus();
  });

  it('outside pointerdown closes the panel and returns focus to the Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    const shareButton = screen.getByTestId('share-button');

    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // A pointerdown on the document (outside the panel and the button).
    fireEvent.pointerDown(document.body);

    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(shareButton).toHaveFocus();
  });

  it('pointerdown inside the panel does not close it (negative)', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));

    fireEvent.pointerDown(screen.getByTestId('share-link-input'));

    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });
});

describe('boardLink', () => {
  it('is `${origin}/b/<id>`', () => {
    expect(boardLink('https://boards.example.com', 'abc')).toBe(
      'https://boards.example.com/b/abc',
    );
  });
});
