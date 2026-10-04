/**
 * The Share panel (story 5, task 5): TC-22, TC-23, TC-24, TC-25.
 *
 * Copying writes the full board link and confirms for LINK_COPIED_MS; when the
 * clipboard refuses (rejected write, or no API at all) the field's content is
 * selected and the manual-copy message appears. The component is rendered
 * directly with the clipboard stubbed, so both the success and fallback paths are
 * covered without a browser.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { boardLink, SharePanel } from '../../src/client/share/SharePanel';
import { MANUAL_COPY_MESSAGE, SHARE_NOTE } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const ID = newBoardId();
const LINK = boardLink(window.location.origin, ID);

function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

function open(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  return screen.getByTestId('share-panel');
}

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('Share panel copy (TC-22, TC-23)', () => {
  it('writes the full link and confirms for exactly LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<SharePanel boardId={ID} />);
    open();
    const copy = screen.getByTestId('share-copy');

    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledWith(LINK);
    // The link is the full board address built from the current origin, and the
    // builder yields an https address verbatim when the origin is https (a real
    // deployment always is).
    expect(LINK).toBe(`${window.location.origin}/b/${ID}`);
    expect(boardLink('https://play.vidi6.dev', ID)).toBe(`https://play.vidi6.dev/b/${ID}`);

    expect(copy).toHaveTextContent('Link copied');
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copy).toHaveTextContent('Link copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(copy).toHaveTextContent('Copy link');
    expect(copy).not.toHaveTextContent('Link copied');
  });

  it('shows the copy control and the access note (TC-23)', () => {
    render(<SharePanel boardId={ID} />);
    const panel = open();
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
    expect(within(panel, SHARE_NOTE)).toBeInTheDocument();
  });
});

describe('Share panel manual-copy fallback (TC-24, TC-25)', () => {
  it('selects the link and shows the manual message when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    setClipboard({ writeText });

    render(<SharePanel boardId={ID} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByTestId('share-copy'));
    });

    expect(screen.getByTestId('share-manual')).toHaveTextContent(MANUAL_COPY_MESSAGE);
    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it('falls back the same way when the clipboard API is missing (TC-25)', async () => {
    setClipboard({}); // navigator.clipboard exists but has no writeText

    render(<SharePanel boardId={ID} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByTestId('share-copy'));
    });

    expect(screen.getByTestId('share-manual')).toHaveTextContent(MANUAL_COPY_MESSAGE);
    const input = screen.getByTestId('share-link') as HTMLInputElement;
    expect(input.value).toBe(LINK);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });
});

/** Find text inside a subtree (a tiny local helper, no extra dependency). */
function within(root: HTMLElement, text: string): HTMLElement {
  const match = [...root.querySelectorAll('*')].find((el) => el.textContent?.includes(text));
  return (match ?? root) as HTMLElement;
}
