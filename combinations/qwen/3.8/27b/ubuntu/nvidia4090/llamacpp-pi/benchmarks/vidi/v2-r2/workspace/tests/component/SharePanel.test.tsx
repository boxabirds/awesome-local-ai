/**
 * Share panel component tests (story 5, TC-22 to TC-25): the panel shows
 * the exact board link, copies via the Clipboard API with the 2-second
 * "Link copied" confirmation, and falls back to a focused, fully-selected
 * link field (with the Ctrl+C hint) when copying is blocked or the API is
 * absent. Escape and outside clicks close the panel and return focus to the
 * Share button.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL_COPY_TEXT = 'Press Ctrl+C (Cmd+C on Mac) to copy';

/** Replaces navigator.clipboard with a fake (per test). */
function installClipboard(fake: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: fake,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SharePanel (share.copy)', () => {
  it('TC-22: panel shows the exact board link; Copy writes it to the clipboard and shows "Link copied" for LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    const writeText = vi.fn(async (_t: string): Promise<void> => undefined);
    installClipboard({ writeText });

    const expected = `${window.location.origin}/b/${id}`;
    expect(boardLink(window.location.origin, id)).toBe(expected);

    render(<SharePanel boardId={id} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
    const input = screen.getByTestId('share-link-input');
    expect((input as HTMLInputElement).value).toBe(expected);
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(screen.getByRole('button', { name: /Link copied/ })).toBeTruthy();

    // still "Link copied" just before the 2-second mark…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: /Link copied/ })).toBeTruthy();
    // …and reverted to "Copy link" once it has passed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-23: a rejected clipboard write shows the manual-copy hint and fully selects the focused link field', async () => {
    const id = newBoardId();
    installClipboard({
      writeText: (): Promise<void> => Promise.reject(new Error('denied')),
    });

    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await screen.findByText(MANUAL_COPY_TEXT);
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(`${window.location.origin}/b/${id}`);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-24: no Clipboard API at all → same manual-copy fallback', async () => {
    const id = newBoardId();
    installClipboard(undefined);

    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await screen.findByText(MANUAL_COPY_TEXT);
    const input = screen.getByTestId('share-link-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-25: Escape and an outside click close the panel; focus returns to the Share button', () => {
    const id = newBoardId();
    render(<SharePanel boardId={id} />);
    const share = screen.getByRole('button', { name: 'Share' });

    // open
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();

    // Escape closes and returns focus to the Share button.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(share);

    // open again; a click outside the panel closes it the same way.
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(share);
  });
});
