// share.share_panel (ui-component): copying the link, and what happens when the
// browser will not allow it.
//
// The clipboard is stubbed rather than real: in jsdom there is nothing behind
// `navigator.clipboard` to grant or refuse, and the three cases that matter - it
// worked, it was refused, it does not exist - are what the panel has to tell apart.
// The real clipboard is exercised end to end in TC-26 and TC-29.
//
// Fake timers, because "Link copied" lasts LINK_COPIED_MS and the boundary is the
// specification: still shown one millisecond before it, gone at it.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

const element = (id: string): HTMLElement | null =>
  document.querySelector(`[data-testid="${id}"]`);

const text = (id: string): string | null => element(id)?.textContent ?? null;

const present = (id: string): boolean => element(id) !== null;

/** Run the fake clock and let React render what it caused. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function installClipboard(clipboard: { writeText: ReturnType<typeof vi.fn> } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

const boardId = (): string => newBoardId();

beforeEach(() => {
  vi.useFakeTimers();
  installClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  installClipboard(undefined);
});

function openPanel(id: string) {
  const utils = render(<SharePanel boardId={id} />);
  fireEvent.click(element('share-button') as HTMLElement);
  return utils;
}

describe('the Share panel (TC-22)', () => {
  it('TC-22 puts the whole link on the clipboard and says so for exactly LINK_COPIED_MS', async () => {
    const id = boardId();
    const writeText = navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
    openPanel(id);

    expect(text('share-field-label')).toBe('Board link');
    expect(text('share-note')).toBe('Anyone with this link can view and edit this board.');

    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);

    // The link, in full, to the board it names - not the path, not the id alone.
    expect(writeText).toHaveBeenCalledWith(boardLink(window.location.origin, id));
    // jsdom's origin is http://localhost:3000, so "https" cannot be asserted here; what
    // can be, and what the person pastes, is the whole address of this board.
    expect((element('share-field') as HTMLInputElement).value).toBe(
      `${window.location.origin}/b/${id}`,
    );

    expect(text('share-copy')).toBe('\u2713 Link copied');
    expect(present('share-manual')).toBe(false);

    // The boundary of the confirmation: still said one millisecond before the end of
    // its time, and gone when its time is up.
    await tick(LINK_COPIED_MS - 1);
    expect(text('share-copy')).toBe('\u2713 Link copied');
    await tick(1);
    expect(text('share-copy')).toBe('Copy link');
  });

  it('TC-22 shows the link in a field that cannot be typed into', () => {
    const id = boardId();
    openPanel(id);
    const field = element('share-field') as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(boardLink(window.location.origin, id));
    // Negative: a read-only field that a click selects is the fallback that needs no
    // permission at all; a click that placed a caret instead would be the bug.
    field.focus();
    field.setSelectionRange(3, 3);
    fireEvent.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('TC-22 a click on the Share button opens the panel, and nothing else does', () => {
    const id = boardId();
    render(<SharePanel boardId={id} />);
    expect(present('share-panel')).toBe(false);
    fireEvent.click(element('share-button') as HTMLElement);
    expect(element('share-panel')?.getAttribute('role')).toBe('dialog');
    expect(element('share-panel')?.getAttribute('aria-label')).toBe('Share board');
  });
});

describe('the manual copy when the clipboard is refused (TC-23, TC-24)', () => {
  it('TC-23 a refused write selects the link and says what to press', async () => {
    const id = boardId();
    const writeText = navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    openPanel(id);

    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);

    expect(writeText).toHaveBeenCalledTimes(1);
    // Never "copied": the browser said no, and a lie here loses the link.
    expect(text('share-copy')).toBe('Copy link');
    expect(present('share-manual')).toBe(true);
    expect(text('share-manual')).toBe(MANUAL);

    // The whole link, held: selected in the field and the field focused, so the copy
    // key has something to take.
    const field = element('share-field') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('TC-24 a browser with no clipboard API at all does the same', async () => {
    // Not a refusal but an absence - an insecure context, or an older browser. The
    // person can still copy; the panel is the one that has to know it cannot.
    const id = boardId();
    installClipboard(undefined);
    const utils = render(<SharePanel boardId={id} />);
    fireEvent.click(element('share-button') as HTMLElement);
    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);

    expect(present('share-manual')).toBe(true);
    expect(text('share-manual')).toBe(MANUAL);
    const field = element('share-field') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionEnd).toBe(field.value.length);
    utils.unmount();
  });

  it('TC-23 the manual message is not a permanent state', async () => {
    // After a refusal the person can still press the button again; a panel stuck in
    // `manual_copy` would keep lecturing them about a copy that has since worked.
    const id = boardId();
    const writeText = navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
    writeText.mockRejectedValueOnce(new Error('NotAllowedError'));
    openPanel(id);
    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);
    expect(present('share-manual')).toBe(true);

    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);
    expect(text('share-copy')).toBe('\u2713 Link copied');
    expect(present('share-manual')).toBe(false);
  });
});

describe('closing the panel (TC-25)', () => {
  it('TC-25 Escape closes it and gives the focus back to the Share button', () => {
    const id = boardId();
    openPanel(id);
    const field = element('share-field') as HTMLInputElement;
    field.focus();
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(present('share-panel')).toBe(false);
    expect(document.activeElement).toBe(element('share-button'));
  });

  it('TC-25 a pointer down outside closes it, and focus returns to the Share button', () => {
    const id = boardId();
    openPanel(id);
    (element('share-field') as HTMLInputElement).focus();

    // Anywhere that is not the panel: the board behind it, in this case.
    fireEvent.pointerDown(document.body);

    expect(present('share-panel')).toBe(false);
    expect(document.activeElement).toBe(element('share-button'));
  });

  it('TC-25 a pointer down inside the panel keeps it open', () => {
    // Negative: the panel is a thing you interact with, not a curtain.
    const id = boardId();
    openPanel(id);
    fireEvent.pointerDown(element('share-field') as HTMLElement);
    expect(present('share-panel')).toBe(true);
  });

  it('TC-25 the panel goes away when the board it shares goes away', async () => {
    // The "Link copied" timer must not outlive the panel: a timer that fires on an
    // unmounted component is a leak, and on a real browser it is a crash waiting for
    // a state that has nowhere to go.
    const id = boardId();
    const { unmount } = openPanel(id);
    fireEvent.click(element('share-copy') as HTMLElement);
    await tick(0);
    expect(text('share-copy')).toBe('\u2713 Link copied');

    unmount();
    await tick(LINK_COPIED_MS * 2);
    expect(present('share-panel')).toBe(false);
  });
});

describe('boardLink', () => {
  it('points at the board path the router answers', () => {
    const id = boardId();
    expect(boardLink('https://board.vidi6.app', id)).toBe(`https://board.vidi6.app/b/${id}`);
    expect(boardLink('http://localhost:5173', id)).toBe(`http://localhost:5173/b/${id}`);
  });
});
