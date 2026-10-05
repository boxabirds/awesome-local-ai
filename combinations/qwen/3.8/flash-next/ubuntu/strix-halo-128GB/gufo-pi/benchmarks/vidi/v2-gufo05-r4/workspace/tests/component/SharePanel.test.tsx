/**
 * The Share panel (TC-22 to TC-25).
 *
 * The panel is a URL, a button and a fallback, so the boundary under test is the clipboard —
 * which is exactly the boundary that differs between browsers. All four conditions are
 * forced here rather than hoped for: a clipboard that works, one that says no, and one that is
 * not there at all, plus the two ways a person dismisses an overlay.
 *
 * The confirmation is timed on both sides of `LINK_COPIED_MS`. A button that changes back too
 * early is a button that looks like it did nothing; one that stays "Link copied" forever is a
 * button nobody dares click again.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardLink, SharePanel } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = newBoardId();
const LINK = boardLink(window.location.origin, BOARD_ID);

/** Replace `navigator.clipboard`, which jsdom does not provide, with one of our own. */
function stubClipboard(clipboard: { writeText: (text: string) => Promise<void> } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function shareButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
}

function linkField(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('.vidi6-share__link')!;
}

function copyButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /copy link|link copied/i }) as HTMLButtonElement;
}

/** The whole of the field's value is selected, and the field has the caret. */
function selectionIsTheLink(): boolean {
  const field = linkField();
  return (
    document.activeElement === field &&
    field.selectionStart === 0 &&
    field.selectionEnd === field.value.length &&
    field.value.length > 0
  );
}

/* `user-event` is deliberately absent: `setup()` installs its own `navigator.clipboard`, which
   would quietly replace the one these tests are about. The panel has three inputs — a click, a
   key and a press outside it — and all three are dispatched directly. */
function openPanel(): void {
  act(() => {
    shareButton().click();
  });
}

/** Let a pending clipboard promise settle inside React's world. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  stubClipboard(undefined);
});

afterEach(() => {
  cleanup();
  stubClipboard(undefined);
  if (vi.isFakeTimers()) vi.useRealTimers();
});

describe('the Share panel', () => {
  it('opens a panel that shows the board link and what it grants', async () => {
    render(<SharePanel boardId={BOARD_ID} />);
    // Closed until asked: the board is the page, and an overlay is not.
    expect(screen.queryByRole('dialog')).toBeNull();

    openPanel();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-label')).toBe('Share board');
    expect(linkField().value).toBe(LINK);
    expect(linkField().readOnly).toBe(true);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeDefined();
    // The link is where the caret is, so Ctrl+C works without touching the field at all.
    expect(document.activeElement).toBe(linkField());
  });

  // TC-22 (`share.copy`)
  it('copies the whole link, says so for LINK_COPIED_MS, and is a copy button again after', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();

act(() => {
      copyButton().click();
    });
    await settle();

    // The full address: what gets pasted into a chat, and what the next person clicks.
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: /link copied/i })).toBeDefined();

    // One millisecond short of the confirmation's end, it is still up.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: /link copied/i })).toBeDefined();

    // And on the millisecond it is not: the panel stays open, the button offers it again.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('button', { name: /link copied/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^copy link$/i })).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  // TC-23 (`share.copy_fallback`)
  it('selects the link and explains what to do when the clipboard says no', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied'));
    stubClipboard({ writeText });
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();

act(() => {
      copyButton().click();
    });
    await settle();

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
    expect(selectionIsTheLink()).toBe(true);
    // No "failed" anything: the link is on screen, selected, one keystroke from working.
    expect(screen.queryByRole('button', { name: /link copied/i })).toBeNull();
  });

  // TC-24 (clipboard missing entirely: insecure origin, older browser)
  it('falls back the same way when the browser has no clipboard at all', async () => {
    stubClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);
    openPanel();

    // The click must not throw on the way past a missing API.
act(() => {
      copyButton().click();
    });
    await settle();

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeDefined();
    expect(selectionIsTheLink()).toBe(true);
  });

  // TC-25
  it('closes on Escape and on a press outside it, and gives the focus back', () => {
    render(<SharePanel boardId={BOARD_ID} />);

    openPanel();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Tab continues from where the person was, not from the top of the document. (Only Escape
    // is checked for this: a press elsewhere takes the focus to wherever it landed, and that is
    // the browser doing its job.)
    expect(document.activeElement).toBe(shareButton());

    openPanel();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves the link selectable in the field, and the trigger closes what it opened', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    openPanel();

    // A click in the field means "I want this text" (`share.copy` behaviour list).
    const field = linkField();
    field.selectionStart = 3;
    fireEvent.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(LINK.length);

    // The panel is an overlay, not a mode: pressing the Share button again closes it rather
    // than reopening it, so the board underneath is never trapped behind it.
    openPanel();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
