// Story 5, client.story5_share_link (TC-22, TC-23, TC-24, TC-25): the Share
// panel. The clipboard is the whole of the panel's job, and a browser is allowed
// to refuse it — so both the success path (one write, the right text, a
// confirmation that clears on its own) and every refusal path (a write that
// rejects, and no clipboard at all) end with the person able to get the link, not
// with a dead button.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharePanel } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const id = 'p1Chvj4mAlXsf8Ue0YUGHw';
const link = () => `${window.location.origin}/b/${id}`;

/** Install a clipboard whose writeText is `fn`, or remove it entirely. */
function setClipboard(fn: { writeText: (t: string) => Promise<void> } | null): void {
  if (fn === null) {
    // TC-25: not every engine has a clipboard at all.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    return;
  }
  Object.defineProperty(navigator, 'clipboard', { value: fn, configurable: true });
}

/** Open the panel and click Copy. */
function openAndCopy(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TC-23: Copy puts the full board link on the clipboard', () => {
  it('calls writeText once, with the exact link', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    render(<SharePanel boardId={id} />);
    openAndCopy();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(link());
  });
});

describe('TC-22: "Link copied" clears itself after LINK_COPIED_MS', () => {
  it('confirms, then goes back to "Copy link" on the timer', async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: async () => {} });
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    // Flush the awaited write, then the confirmation is showing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Link copied/)).toBeTruthy();
    // After LINK_COPIED_MS the panel is back to the plain Copy button.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS);
    });
    expect(screen.queryByText(/Link copied/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });
});

describe('TC-24: a clipboard write that is refused selects the link instead', () => {
  it('shows the copy-by-hand message and a selected field', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    setClipboard({ writeText });
    render(<SharePanel boardId={id} />);
    openAndCopy();
    await waitFor(() => expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy());
    // The link is there to be copied by hand, selected.
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe(link());
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(link().length);
  });
});

describe('TC-25: with no clipboard API at all, the link is still copyable', () => {
  it('falls back to the manual copy when navigator.clipboard is absent', () => {
    setClipboard(null);
    render(<SharePanel boardId={id} />);
    openAndCopy();
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect(field.value).toBe(link());
  });
});

describe('the panel states the access model', () => {
  it('says anyone with the link can view and edit', () => {
    setClipboard({ writeText: async () => {} });
    render(<SharePanel boardId={id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
  });
});
