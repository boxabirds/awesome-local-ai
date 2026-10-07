// TC-22–TC-25 (story 5): the Share panel — link content, copy + confirmation
// timing, the manual-copy fallback, and closing with focus return.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const BOARD_ID = 's'.repeat(22);
// jsdom's origin: the link must be the full address `${origin}/b/<id>`.
const ORIGIN = window.location.origin;
const LINK = boardLink(ORIGIN, BOARD_ID);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

describe('Share panel (share.share_panel, share.copy, share.copy_fallback)', () => {
  it('TC-22: Copy link copies the full link; "Link copied" for LINK_COPIED_MS, then reverts to Copy link', async () => {
    vi.useFakeTimers();
    try {
      render(<SharePanel boardId={BOARD_ID} />);
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

      const input = screen.getByRole('textbox', { name: 'Board link' });
      expect(input).toHaveValue(LINK);
      expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(LINK);
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

      // 1 ms before the duration ends: still "Link copied".
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
      });
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

      // 1 ms after: back to "Copy link".
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-23: writeText rejects → "Press Ctrl+C (Cmd+C on Mac) to copy" and the full link selected', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {
      // Flush the writeText rejection (microtask).
    });

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input).toHaveValue(LINK);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-24: navigator.clipboard missing → manual-copy message and the full link selected', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input).toHaveValue(LINK);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-25: Escape and an outside pointerdown close the panel; focus returns to the Share button', async () => {
    render(<SharePanel boardId={BOARD_ID} />);
    const share = screen.getByRole('button', { name: 'Share' });

    // Escape closes.
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(share);

    // An outside pointerdown closes.
    fireEvent.click(share);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(share);
  });
});
