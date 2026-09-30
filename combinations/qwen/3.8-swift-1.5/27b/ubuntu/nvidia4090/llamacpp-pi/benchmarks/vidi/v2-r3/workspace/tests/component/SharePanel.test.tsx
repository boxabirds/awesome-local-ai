// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'abcdEFGH1234567890AB'; // 22 chars

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubClipboardWriteText(impl: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: impl },
    configurable: true,
    writable: true,
  });
}

describe('TC-22: copy to clipboard (share.copy)', () => {
  it('shows the full link, copies it, and reverts after LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboardWriteText((text) => writeText(text));

    render(<SharePanel boardId={BOARD_ID} />);
    const expectedLink = boardLink(window.location.origin, BOARD_ID);

    await act(async () => {
      screen.getByTestId('share-button').click();
    });
    const input = screen.getByTestId('share-link-input');
    expect(input).toHaveValue(expectedLink);

    await act(async () => {
      screen.getByTestId('copy-link-button').click();
    });
    expect(writeText).toHaveBeenCalledWith(expectedLink);
    expect(screen.getByTestId('copy-link-button')).toHaveTextContent('Link copied');

    // Still "Link copied" just before the timeout
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link-button')).toHaveTextContent('Link copied');

    // Reverts to "Copy link" after LINK_COPIED_MS
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('copy-link-button')).toHaveTextContent('Copy link');
  });
});

describe('TC-23: clipboard write rejected (share.copy)', () => {
  it('fully selects the link input and shows the manual-copy hint', async () => {
    stubClipboardWriteText(() => Promise.reject(new Error('denied')));

    render(<SharePanel boardId={BOARD_ID} />);
    await act(async () => {
      screen.getByTestId('share-button').click();
    });
    await act(async () => {
      screen.getByTestId('copy-link-button').click();
    });

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(screen.getByTestId('manual-copy-message')).toBeInTheDocument();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input.value).toBe(boardLink(window.location.origin, BOARD_ID));
  });
});

describe('TC-24: no clipboard API (share.copy)', () => {
  it('falls back to selection + manual-copy hint when navigator.clipboard is absent', async () => {
    // Remove the clipboard API entirely
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);
    await act(async () => {
      screen.getByTestId('share-button').click();
    });
    await act(async () => {
      screen.getByTestId('copy-link-button').click();
    });

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(screen.getByTestId('manual-copy-message')).toBeInTheDocument();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('TC-25: closing the panel (share.copy)', () => {
  it('Escape closes the panel and returns focus to the Share button', async () => {
    render(<SharePanel boardId={BOARD_ID} />);
    await act(async () => {
      screen.getByTestId('share-button').click();
    });
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('share-button')).toHaveFocus();
  });

  it('an outside pointerdown closes the panel and returns focus to the Share button', async () => {
    render(<SharePanel boardId={BOARD_ID} />);
    await act(async () => {
      screen.getByTestId('share-button').click();
    });
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    act(() => {
      // jsdom has no PointerEvent; the listener matches on the type string
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('share-button')).toHaveFocus();
  });
});
