/**
 * Story 5, share.share_panel: component tests for the Share panel
 * (stubbed clipboard, fake timers for the "Link copied" window).
 *
 * Clicks use fireEvent (synchronous) rather than userEvent: userEvent's
 * timer-driven pointer sequence deadlocks under vitest fake timers in this
 * environment.
 *
 * TC-22 to TC-25.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SharePanel } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const ORIGIN = window.location.origin; // jsdom default origin

/** Replace navigator.clipboard with a stub (restored by jsdom per test). */
function stubClipboard(clipboard: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openPanel(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  });
}

describe('share.share_panel', () => {
  it('TC-22: Copy link → writeText with full link; "Link copied" reverts at LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const id = newBoardId();
    const link = `${ORIGIN}/b/${id}`;

    render(<SharePanel boardId={id} />);
    await openPanel();

    // Panel with the full link in a read-only field and the access note.
    const dialog = screen.getByRole('dialog', { name: 'Share board' });
    expect(dialog).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Board link' });
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue(link);
    expect(
      screen.getByText('Anyone with this link can view and edit this board.'),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(link);

    // "Link copied" is visible at LINK_COPIED_MS - 1 ...
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: /Link copied/ })).toBeInTheDocument();

    // ...and has reverted by exactly LINK_COPIED_MS.
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-23: writeText rejects → full link selected in the field + manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    stubClipboard({ writeText });
    const id = newBoardId();

    render(<SharePanel boardId={id} />);
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });

    // waitFor/findBy* use real intervals and hang under vitest fake timers;
    // the microtask has already been flushed by act above.
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input.value).toBe(`${ORIGIN}/b/${id}`);
  });

  it('TC-24: navigator.clipboard missing → same manual-copy fallback', async () => {
    stubClipboard(undefined);
    const id = newBoardId();

    render(<SharePanel boardId={id} />);
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-25: Escape closes; outside pointerdown closes; focus returns to Share', async () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    const id = newBoardId();

    // Escape.
    const first = render(<SharePanel boardId={id} />);
    const shareButton = screen.getByRole('button', { name: 'Share' });
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(shareButton).toHaveFocus();
    first.unmount();

    // Outside pointerdown.
    render(<SharePanel boardId={id} />);
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveFocus();
  });
});
