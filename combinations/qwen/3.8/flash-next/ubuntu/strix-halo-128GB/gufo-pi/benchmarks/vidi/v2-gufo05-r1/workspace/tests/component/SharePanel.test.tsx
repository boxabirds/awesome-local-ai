/**
 * The Share panel: the link, the copy, and what happens when the copy does not work.
 *
 * The panel's promise is small and specific — put this board's address on the clipboard —
 * and the tests are arranged around the three ways that can end: it worked, it was refused,
 * and there was nothing to ask. Only the first is allowed to say "Link copied", which is why
 * the clipboard call is a mock the test controls rather than a clipboard: the assertion that
 * matters is that a refusal is *not* reported as a success.
 *
 * TC numbers are the design's (spec/stories/005-…/design.md).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

/** Install (or remove) the clipboard. `undefined` is a browser that has none. */
function withClipboard(writeText: (() => Promise<void>) | undefined): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: writeText === undefined ? undefined : { writeText },
  });
}

function openPanel(boardId: string): { share: HTMLButtonElement } {
  render(<SharePanel boardId={boardId} />);
  const share = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
  fireEvent.click(share);
  return { share };
}

const linkInput = () => screen.getByRole('textbox') as HTMLInputElement;

/** Let the clipboard's promise settle, and the state it set render. */
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  withClipboard(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  withClipboard(undefined);
});

describe('the link (TC-22)', () => {
  it('opens to this board’s exact address', () => {
    const id = newBoardId();
    openPanel(id);
    const input = linkInput();
    // The exact string, with the protocol and the host: a link missing either is not a
    // link, and this app promises the person next to nothing about what they paste.
    expect(input.value).toBe(`${window.location.origin}/b/${id}`);
    expect(input.value).toBe(boardLink(window.location.origin, id));
    // Read-only: the value is the thing, and a mistyped link is not a fix.
    expect(input.readOnly).toBe(true);
    // The permission explained, because the link is the permission.
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('is closed until somebody asks', () => {
    render(<SharePanel boardId={newBoardId()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
  });
});

describe('copying the link (TC-22, TC-23, TC-24)', () => {
  it('TC-22 copies the whole link, holds the confirmation for LINK_COPIED_MS and no longer', async () => {
    vi.useFakeTimers();
    const id = newBoardId();
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    openPanel(id);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settled();

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/b/${id}`);
    expect(screen.getByText('Link copied')).toBeTruthy();
    expect(screen.queryByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeNull();

    // The boundary the design asks for: still confirming one millisecond before the wait
    // ends, and an offer again at the moment it does. A confirmation that never ends lies
    // about the second copy; one that ends early is a flicker nobody can read.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByText('Link copied')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Link copied')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-22 copies again on the next press', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    openPanel(newBoardId());

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settled();
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settled();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Link copied')).toBeTruthy();
  });

  it('TC-23 selects the link and says what to press when the clipboard refuses', async () => {
    const id = newBoardId();
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    withClipboard(writeText);
    openPanel(id);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settled();

    // Never "copied". The panel stays open, the link stays selected, and it says what to
    // press instead.
    expect(screen.queryByText('Link copied')).toBeNull();
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    const input = linkInput();
    // The selection is the fallback: with it, the next Ctrl+C copies the link, so the
    // person needs neither the mouse nor the button.
    expect(input.value).toBe(`${window.location.origin}/b/${id}`);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(document.activeElement).toBe(input);
  });

  it('TC-24 does the same when there is no clipboard to ask', async () => {
    // `navigator.clipboard` is missing over plain HTTP and in older browsers. Nothing is
    // thrown, and the manual path appears — the identical fallback, not a second one.
    withClipboard(undefined);
    const id = newBoardId();
    openPanel(id);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await settled();

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
    const input = linkInput();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('closing the panel (TC-25)', () => {
  it('closes on Escape and on a click outside', () => {
    const id = newBoardId();
    render(<SharePanel boardId={id} />);
    const share = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;

    fireEvent.click(share);
    expect(screen.getByRole('textbox')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(share);
    expect(screen.getByRole('textbox')).toBeTruthy();
    fireEvent.pointerDown(window.document.body);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('gives focus back to the button it opened from', () => {
    const { share } = openPanel(newBoardId());
    // The link takes focus when the panel opens: it is what the person came for, and it
    // arrives selected, so it can be copied without the button at all.
    expect(document.activeElement).toBe(linkInput());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(share);

    fireEvent.click(share);
    fireEvent.pointerDown(window.document.body);
    expect(document.activeElement).toBe(share);
  });
});
