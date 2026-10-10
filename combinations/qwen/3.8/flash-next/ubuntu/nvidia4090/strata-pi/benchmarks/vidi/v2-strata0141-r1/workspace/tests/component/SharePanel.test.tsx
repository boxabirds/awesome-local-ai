import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';

/**
 * The Share panel (`share.copy_link`, and the fallback `share.copy_link` names).
 *
 * Two things are checked here that no e2e run can check reliably: the exact
 * moment "Link copied" stops being shown, and what the panel does when the
 * browser refuses to touch the clipboard. In a real browser `navigator.clipboard`
 * is missing or blocked often enough - insecure page, no permission, a gesture the
 * browser did not count - that the fallback is the normal path, not the odd one.
 */

const BOARD = 'componentboard00000000';
const LINK = `https://vidi6.example/b/${BOARD}`;

const { SharePanel, boardLink } = await import('../../src/client/share/SharePanel');

const setClipboard = (value: Clipboard | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
    return;
  }
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true });
};

const selectedRange = (): { start: number; end: number } => {
  const input = screen.getByTestId<HTMLInputElement>('share-link');
  return { start: input.selectionStart ?? -1, end: input.selectionEnd ?? -1 };
};

const open = () => {
  fireEvent.click(screen.getByTestId('share-button'));
};

beforeEach(() => {
  setClipboard(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('the Share panel (share.copy_link)', () => {
  it('shows the whole board link, and one click selects all of it (D1 copy link)', () => {
    render(<SharePanel boardId={BOARD} />);

    expect(screen.queryByTestId('share-panel')).toBeNull();
    open();

    const input = screen.getByTestId<HTMLInputElement>('share-link');
    expect(input.value).toBe(LINK);
    expect(input.readOnly).toBe(true);
    expect(boardLink(BOARD)).toBe(LINK);

    // Selecting everything: Ctrl/Cmd+C is then the only thing to press.
    fireEvent.click(input);
    expect(selectedRange()).toEqual({ start: 0, end: LINK.length });
  });

  it('TC-22: Copy link puts the link on the clipboard and the confirmation expires (boundary "confirmation reverts after LINK_COPIED_MS")', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn((_value: string) => Promise.resolve());
    setClipboard({ writeText } as unknown as Clipboard);

    render(<SharePanel boardId={BOARD} />);
    open();
    fireEvent.click(screen.getByTestId('share-copy'));

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    // The full link, not just the id: a person pasting it gets a working address.
    expect(writeText.mock.calls[0]?.[0]).toBe(LINK);

    const copyButton = screen.getByTestId('share-copy');
    expect(copyButton.textContent).toBe('Link copied');

    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copyButton.textContent).toBe('Link copied');

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(copyButton.textContent).toBe('Copy link');
  });

  it('closes on Escape and on a click outside, and the focus goes back to Share', () => {
    render(<SharePanel boardId={BOARD} />);
    const button = screen.getByTestId('share-button');

    open();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(button);

    open();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // A pointer down anywhere else on the board ends the panel.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(button);

    // A pointer down inside the panel keeps it open.
    open();
    fireEvent.pointerDown(screen.getByTestId('share-panel'));
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('TC-23: with no clipboard on this browser, the link is on screen and selected (D1 fallback/negative: clipboard unavailable)', () => {
    setClipboard(undefined);
    expect(typeof navigator.clipboard).toBe('undefined');

    render(<SharePanel boardId={BOARD} />);
    open();
    fireEvent.click(screen.getByTestId('share-copy'));

    expect(screen.getByTestId('share-manual').textContent).toBe('Copy the link above');
    // Nothing was asked of the browser, and the field is ready for a keystroke.
    expect(selectedRange()).toEqual({ start: 0, end: LINK.length });
    expect(document.activeElement).toBe(screen.getByTestId('share-link'));
  });

  it('TC-23: a clipboard that refuses the write falls back the same way (error path)', async () => {
    const writeText = vi.fn((_value: string) => Promise.reject(new Error('NotAllowedError')));
    setClipboard({ writeText } as unknown as Clipboard);

    render(<SharePanel boardId={BOARD} />);
    open();
    fireEvent.click(screen.getByTestId('share-copy'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('share-manual')).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
    expect(selectedRange()).toEqual({ start: 0, end: LINK.length });
  });
});
