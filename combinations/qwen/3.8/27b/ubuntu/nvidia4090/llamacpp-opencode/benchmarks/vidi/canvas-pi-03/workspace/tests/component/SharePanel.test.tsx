/**
 * Story 5 — share.share_panel component tests (TC-22..TC-25).
 *
 * The Clipboard API is stubbed (jsdom has none) and fake timers are used for
 * the "Link copied" confirmation boundary (LINK_COPIED_MS).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { newBoardId } from '@/shared/board-id';
import { LINK_COPIED_MS } from '@/shared/config';
import {
  SharePanel,
  boardLink,
  COPIED_TEXT,
  MANUAL_COPY_TEXT,
  SHARE_NOTE_TEXT,
} from '@/client/share/SharePanel';

function stubClipboard(writeText?: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn();
  stubClipboard(writeText);
});

afterEach(() => {
  vi.useRealTimers();
  // Restore jsdom's default (no clipboard).
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('share.share_panel (story 5)', () => {
  it('TC-22: copy -> full link written; "Link copied" until LINK_COPIED_MS, then reverts', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    window.history.pushState({}, '', '/b/' + id);
    render(<SharePanel boardId={id} />);

    // Closed by default; the Share button opens the dialog.
    expect(screen.queryByTestId('share-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('share-button'));
    const dialog = screen.getByTestId('share-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('share-note')).toHaveTextContent(SHARE_NOTE_TEXT);

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    const link = boardLink(window.location.origin, id);
    expect(link).toBe(`${window.location.origin}/b/${id}`);
    expect(input.value).toBe(link);

    writeText.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await act(async () => {}); // the writeText promise resolves

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(link);
    const copyButton = screen.getByTestId('copy-link-button');
    expect(copyButton.textContent).toBe(COPIED_TEXT);

    // Boundary: still confirmed at LINK_COPIED_MS - 1 ...
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link-button').textContent).toBe(COPIED_TEXT);
    // ... and reverted exactly at LINK_COPIED_MS.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Copy link');
    expect(screen.queryByTestId('manual-copy-message')).toBeNull();
  });

  it('TC-23: writeText rejects -> input fully selected + manual-copy message', async () => {
    const id = newBoardId();
    window.history.pushState({}, '', '/b/' + id);
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByTestId('share-button'));

    writeText.mockRejectedValue(new Error('NotAllowedError'));
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await act(async () => {});

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length); // fully selected
    expect(screen.getByTestId('manual-copy-message')).toHaveTextContent(MANUAL_COPY_TEXT);
    expect(screen.getByRole('status')).toHaveTextContent(MANUAL_COPY_TEXT);
    // The button is back to its normal label (no "Link copied").
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Copy link');
  });

  it('TC-24: navigator.clipboard undefined -> same manual-copy fallback', async () => {
    stubClipboard(undefined);
    const id = newBoardId();
    window.history.pushState({}, '', '/b/' + id);
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByTestId('share-button'));

    expect(navigator.clipboard).toBeUndefined();
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await act(async () => {});

    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.getByTestId('manual-copy-message')).toHaveTextContent(MANUAL_COPY_TEXT);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('TC-25: Escape closes; outside click closes; focus returns to the Share button', () => {
    const id = newBoardId();
    window.history.pushState({}, '', '/b/' + id);
    render(<SharePanel boardId={id} />);

    const shareButton = screen.getByTestId('share-button');

    // Open, then close with Escape.
    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-dialog')).toBeNull();
    expect(shareButton).toHaveFocus();

    // Open again, then close with a click outside the dialog.
    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-dialog')).toBeNull();
    expect(shareButton).toHaveFocus();
  });
});
