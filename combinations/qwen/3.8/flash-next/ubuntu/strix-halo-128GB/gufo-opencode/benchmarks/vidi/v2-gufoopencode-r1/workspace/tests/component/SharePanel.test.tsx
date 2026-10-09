import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel } from '../../src/client/share/SharePanel';

const BOARD_ID = 'abcdefghijklmnopqrstuv';
// The component builds the link from window.location.origin (which jsdom
// serves on port 3000); read it back so the assertion is origin-agnostic.
const LINK = window.location.origin + `/b/${BOARD_ID}`;

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(value: Clipboard | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', `/b/${BOARD_ID}`);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalClipboard === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', originalClipboard);
});

describe('share.share_panel', () => {
  test('TC-22 Copy link writes the full link; "Link copied" held to LINK_COPIED_MS − 1, reverted at LINK_COPIED_MS', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('copy-link-button'));
    expect(writeText).toHaveBeenCalledWith(LINK);
    // flush the writeText microtask so `copied` is set, then boundary checks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Link copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Link copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('copy-link-button').textContent).toBe('Copy link');
  });

  test('TC-23 writeText rejects → link fully selected and manual-copy message shown', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('copy-link-button'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
    expect(screen.getByTestId('manual-copy-message').textContent).toContain('Press Ctrl+C');
  });

  test('TC-24 navigator.clipboard undefined → same manual-copy path', () => {
    setClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.click(screen.getByTestId('copy-link-button'));
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(LINK.length);
    expect(screen.getByTestId('manual-copy-message').textContent).toContain('Press Ctrl+C');
  });

  test('TC-25 Escape and outside click both close; focus returns to the Share button', () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    const shareButton = screen.getByTestId('share-button');

    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(shareButton);

    fireEvent.click(shareButton);
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(shareButton);
  });
});
