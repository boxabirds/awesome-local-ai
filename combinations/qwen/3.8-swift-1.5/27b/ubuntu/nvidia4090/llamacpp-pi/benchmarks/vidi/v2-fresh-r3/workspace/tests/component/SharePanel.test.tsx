import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

/**
 * Installs a `navigator.clipboard.writeText` mock (jsdom has none). Returns the
 * mock so tests can assert on / fail it.
 */
function mockClipboard(impl?: () => Promise<void>): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(impl ?? (async () => {}));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return { writeText };
}

const BOARD_ID = 'a'.repeat(22);
const EXPECTED_LINK = `https://example.com/b/${BOARD_ID}`;

beforeEach(() => {
  window.history.pushState({}, '', `/b/${BOARD_ID}`);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SharePanel', () => {
  it('boardLink builds the full link from origin + id', () => {
    expect(boardLink('https://example.com', BOARD_ID)).toBe(EXPECTED_LINK);
  });

  it('opens a dialog with the link field, copy button, and note; closes on Escape', () => {
    render(<SharePanel boardId={BOARD_ID} />);

    // Closed initially.
    expect(screen.queryByTestId('share-panel')).toBeNull();

    // Opens.
    fireEvent.click(screen.getByTestId('share-button'));
    const panel = screen.getByTestId('share-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('Share board');

    // Link field shows the full link.
    expect((screen.getByTestId('share-link-input') as HTMLInputElement).value).toBe(EXPECTED_LINK);

    // Copy button + note.
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Copy link');
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();

    // Escape closes.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('closes on a pointerdown outside the panel and the Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).not.toBeNull();

    // A raw pointerdown on the document body (outside the panel + button).
    // (jsdom has no PointerEvent; the handler only reads e.target.)
    const event = new Event('pointerdown', { bubbles: true });
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('does not close on a pointerdown inside the panel', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const panel = screen.getByTestId('share-panel');

    const event = new Event('pointerdown', { bubbles: true });
    panel.dispatchEvent(event);

    expect(screen.queryByTestId('share-panel')).not.toBeNull();
  });

  it('Copy link writes the full link to the clipboard and shows "Link copied" for 2s', async () => {
    vi.useFakeTimers();
    const { writeText } = mockClipboard();
    render(<SharePanel boardId={BOARD_ID} />);

    fireEvent.click(screen.getByTestId('share-button'));
    const copyBtn = screen.getByTestId('copy-link-button');

    await act(async () => {
      fireEvent.click(copyBtn);
      // Let the async copy() resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(EXPECTED_LINK);
    expect(copyBtn.textContent).toContain('Link copied');

    // Reverts after LINK_COPIED_MS.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS);
    });
    expect(copyBtn.textContent).toBe('Copy link');
  });

  it('on clipboard failure, selects the link and shows the manual-copy message', async () => {
    mockClipboard(async () => {
      throw new Error('Permission denied');
    });
    render(<SharePanel boardId={BOARD_ID} />);

    fireEvent.click(screen.getByTestId('share-button'));
    const copyBtn = screen.getByTestId('copy-link-button');

    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The manual-copy message is shown.
    expect(screen.getByTestId('manual-copy-message').textContent).toBe(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    // The link field is focused + selected.
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(EXPECTED_LINK.length);
  });
});
