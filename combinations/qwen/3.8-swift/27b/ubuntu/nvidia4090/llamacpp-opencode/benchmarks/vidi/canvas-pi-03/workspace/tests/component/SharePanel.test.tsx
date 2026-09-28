/**
 * Story 5: Share panel component tests (share.share_panel, share.copy,
 * share.copy_fallback).
 *
 * TC-22: Share opens the panel with the full board link; Copy link →
 *        "✓ Link copied" for LINK_COPIED_MS → back to "Copy link".
 * TC-23: clipboard writeText rejects → the manual-copy message appears and
 *        the field is focused+selected.
 * TC-24: Escape closes the panel and focus returns to the Share button.
 * TC-25: clicking the read-only field selects the whole link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharePanel } from 'src/client/share/SharePanel';
import { LINK_COPIED_MS } from 'src/shared/config';
import { advanceUntil } from './ready';

const BOARD_ID = 'abcdefghijklmnopqrstuv';
const LINK = `${window.location.origin}/b/${BOARD_ID}`;

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('share.share_panel / share.copy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('TC-22: Share opens the panel with the full link; Copy link → "Link copied" for 2 s → "Copy link"', async () => {
    let copied: string | null = null;
    mockClipboard(async (text) => {
      copied = text;
    });
    render(<SharePanel boardId={BOARD_ID} />);

    // Closed by default: panel absent, Share button present.
    expect(screen.queryByTestId('share-panel')).toBeNull();
    const share = screen.getByTestId('share-button');
    fireEvent.click(share);

    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(field).toHaveValue(LINK);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();

    // Copy: the clipboard receives the full address, the button reads
    // "Link copied" for exactly LINK_COPIED_MS, then reverts. (findBy* cannot
    // poll under fake timers; advanceUntil flushes the writeText().then() and
    // React's re-render.)
    fireEvent.click(screen.getByTestId('copy-link-button'));
    // advanceUntil flushes writeText().then() and React's re-render; it stops
    // the moment the button reads "Link copied" (the revert timer is scheduled
    // by that same state change).
    await advanceUntil(
      () =>
        copied === LINK &&
        screen.getByTestId('copy-link-button').textContent?.includes('Link copied'),
      vi,
    );
    vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    expect(screen.getByTestId('copy-link-button')).toHaveTextContent('Link copied');
    // Advance past the revert point and flush React's re-render (a synchronous
    // advance fires the timer but does not re-render).
    await advanceUntil(
      () => screen.getByTestId('copy-link-button').textContent?.includes('Copy link'),
      vi,
      3000,
    );
    expect(screen.getByTestId('copy-link-button')).toHaveTextContent('Copy link');
  });

  it('TC-23: clipboard failure → manual-copy message and the field is focused + selected', async () => {
    mockClipboard(async () => {
      throw new Error('denied');
    });
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));

    fireEvent.click(screen.getByTestId('copy-link-button'));
    // writeText rejects → the .catch fallback appears (advanceUntil flushes
    // the promise chain and React's re-render under fake timers).
    await advanceUntil(
      () => screen.queryByTestId('manual-copy-message'),
      vi,
    );
    expect(screen.getByTestId('manual-copy-message')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
  });

  it('TC-24: Escape closes the panel and focus returns to the Share button', () => {
    mockClipboard(async () => {});
    render(<SharePanel boardId={BOARD_ID} />);
    const share = screen.getByTestId('share-button');
    fireEvent.click(share);
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(share);
  });

  it('TC-25: clicking the link field selects the whole link', () => {
    mockClipboard(async () => {});
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    fireEvent.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);
  });

  it('share.share_panel: a pointerdown outside the panel closes it', () => {
    mockClipboard(async () => {});
    const { container } = render(
      <div>
        <button id="outside">outside</button>
        <SharePanel boardId={BOARD_ID} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    fireEvent.pointerDown(container.querySelector('#outside')!);
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });
});
