// Story 5 task 6 (share.share_panel): copy link with manual-copy fallback
// and panel close behaviour. TC-22, TC-23, TC-24, TC-25.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'sharepaneltestboard000';

function setClipboard(value: Clipboard | undefined): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
  });
}

function openPanel(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('SharePanel (share.copy)', () => {
  it('TC-22: Copy link writes the full link; confirmation lasts exactly LINK_COPIED_MS', async () => {
    expect(boardLink('https://vidi6.example', 'abc123')).toBe('https://vidi6.example/b/abc123');

    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);

    openPanel();
    const link = `${window.location.origin}/b/${BOARD_ID}`;
    const field = screen.getByRole('textbox', { name: 'Board link' });
    expect(field).toHaveValue(link);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(link);
    await act(async () => {
      await Promise.resolve();
    });

    // Reverts only after exactly LINK_COPIED_MS.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-23: a rejected clipboard selects the whole link and shows the manual-copy hint', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy');
    const field = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
  });

  it('TC-24: a missing clipboard API takes the same manual-copy path', () => {
    setClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByRole('status')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy');
    const field = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('TC-25: Escape and outside pointerdown both close the panel; focus returns to Share', () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    const shareButton = screen.getByRole('button', { name: 'Share' });

    openPanel();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openPanel();
    fireEvent.pointerDown(document.body, { pointerId: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Re-opening and closing returns focus to the Share button.
    expect(document.activeElement).toBe(shareButton);
  });
});
