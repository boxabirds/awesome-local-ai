import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const BOARD_ID = 'abcdefghijklmnopqrstuv';
const LINK = boardLink(window.location.origin, BOARD_ID);

function setClipboard(clipboard: Clipboard | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true
  });
}

function openPanel(): HTMLButtonElement {
  const share = screen.getByRole('button', { name: 'Share' });
  fireEvent.click(share);
  return share as HTMLButtonElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('SharePanel (TC-22 to TC-25)', () => {
  it('TC-22 copies the full link and shows "Link copied" until the boundary', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);

    openPanel();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(LINK);
    expect(input).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await actFlush();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-23 a rejected write selects the field and shows the manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await actFlush();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-24 a missing clipboard API falls back to the manual-copy message', () => {
    setClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('TC-25 Escape and an outside click close the panel and return focus to Share', () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);

    let share = openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(share);

    share = openPanel();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(share);
  });
});

// Flushes pending microtasks (the awaited clipboard promise) under fake timers.
async function actFlush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
