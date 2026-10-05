/**
 * Component tests for the Share panel (share.copy).
 *
 * The panel has one job — get a board's address onto the way out — and these tests are organized
 * around the two ways that can fail: the clipboard says no, and the clipboard is not there. Both are
 * tested all the way to the thing the person can actually do about it, which is a selected link and
 * a keystroke, because "it failed politely" is not something you can see. The tests that read a
 * message also read the field: a panel that says *press Ctrl+C* over a link that is not selected has
 * written a message nobody can act on.
 *
 * Timers are faked in here. The green "Link copied" is held for a fixed, spec'd number of
 * milliseconds, and a test that waited for that in real time would be slow, and a slow test of a
 * duration is a test that eventually gets switched off.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCESS_NOTE, SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const id = newBoardId();
const link = boardLink(window.location.origin, id);

/**
 * The link, as an address rather than as a string the same module produced: origin, `/b/`, and a
 * board id that is a board id.
 *
 * The scheme comes from the page rather than from the spec sheet. These tests run on jsdom's default
 * origin, which is `http://localhost:3000`, and the spec's `https://localhost:3000/...` was written
 * against a browser where the dev server is served over TLS; asserting the literal would test which
 * host the test runner chose. What the product promises is that the link is *this app's* address for
 * *this board*, so the scheme is checked as a scheme and the rest is checked exactly.
 */
const linkShape = /^https?:\/\/localhost:3000\/b\/[A-Za-z0-9_-]{22}$/;

/** The clipboard, set to whatever this test needs it to be — including absent. */
function withClipboard(clipboard: { writeText(text: string): Promise<void> } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

function clipboardThatTakes(): { writeText: (text: string) => Promise<void> } {
  const clipboard = { writeText: vi.fn((): Promise<void> => Promise.resolve()) };
  withClipboard(clipboard);
  return clipboard;
}

function clipboardThatRefuses(): { writeText: (text: string) => Promise<void> } {
  const clipboard = {
    writeText: vi.fn((): Promise<void> => Promise.reject(new Error('NotAllowedError: not allowed to write'))),
  };
  withClipboard(clipboard);
  return clipboard;
}

/** Whatever is in flight, arriving. The clipboard answers on a promise, and nothing else waits. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openPanel(): void {
  render(<SharePanel boardId={id} />);
  fireEvent.click(screen.getByTestId('share-button'));
}

function field(): HTMLInputElement {
  const element = screen.getByTestId('share-link');
  if (!(element instanceof HTMLInputElement)) throw new Error('the link is not in a field');
  return element;
}

/** The whole of the link, or none of it: this is what the fallback rests on. */
function selectedText(element: HTMLInputElement): string {
  return element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // The clipboard belongs to jsdom, not to this file.
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('the share panel (TC-22 … TC-25)', () => {
  it('opens on the link, ready to copy (TC-22)', async () => {
    clipboardThatTakes();
    openPanel();

    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    // The link, in a field the person can read and select even if no clipboard lets them copy it.
    expect(screen.getByTestId('share-link')).toHaveValue(link);
    expect(link).toMatch(linkShape);
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
    // The promise, on the panel rather than behind a click: this is the place where the reach of a
    // link is stated, and it is stated before the link leaves.
    expect(screen.getByTestId('share-note')).toHaveTextContent(ACCESS_NOTE);
    expect(screen.getByTestId('share-note')).toHaveTextContent(
      'Anyone with this link can view and edit this board.',
    );

    // Opened, the field has the focus and the whole link is already selected, so the panel is one
    // keystroke from being done.
    expect(field()).toHaveFocus();
    expect(selectedText(field())).toBe(link);

    // A second press of Share shuts it: one control, opening and closing.
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('copies the link and says so, for a while (TC-22)', async () => {
    const clipboard = clipboardThatTakes();
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();

    expect(clipboard.writeText).toHaveBeenCalledWith(link);
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied');

    // The reassurance is held for as long as the spec says and not one moment longer…
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');

    // …and the panel stays open with its link, because the person who asked for the link is about to
    // paste it somewhere. A panel that shuts itself after copying sends them looking for it again.
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();
    expect(screen.getByTestId('share-link')).toHaveValue(link);
  });

  it('falls back to the keyboard when the clipboard refuses the link (TC-23)', async () => {
    const clipboard = clipboardThatRefuses();
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();

    expect(screen.getByTestId('share-manual')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    // The other half of the fallback, without which the message is a note and not a way out: the
    // whole link is selected and the field has the focus, so the keys named do the job.
    expect(field()).toHaveFocus();
    expect(selectedText(field())).toBe(link);

    // And nothing claims the link was copied. A panel that says "Link copied" over a clipboard that
    // refused is worse than one that says nothing: the person pastes somewhere else and finds the
    // board missing in the one place they were sure they had left it.
    expect(clipboard.writeText).toHaveBeenCalledWith(link);
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('falls back to the keyboard when there is no clipboard at all (TC-24)', async () => {
    // Not a browser to be rude about: the asynchronous clipboard is absent over plain HTTP on a
    // non-localhost address, which is a perfectly ordinary way to open a board on a phone.
    withClipboard(undefined);
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();

    expect(screen.getByTestId('share-manual')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    expect(selectedText(field())).toBe(link);
    expect(field()).toHaveFocus();
    // The link is still on the screen, which is the reason the field is a field.
    expect(screen.getByTestId('share-link')).toHaveValue(link);
  });

  it('says the same thing again if asked again, and does not say it twice (TC-24)', async () => {
    const clipboard = clipboardThatRefuses();
    openPanel();

    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();
    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();

    expect(screen.getAllByTestId('share-manual')).toHaveLength(1);
    expect(clipboard.writeText).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape and on a pointer outside, and gives the focus back (TC-25)', async () => {
    clipboardThatTakes();
    openPanel();
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    // The focus goes back where the person was standing, rather than to the top of the page.
    expect(screen.getByTestId('share-button')).toHaveFocus();

    // A pointer landing anywhere outside the panel is the same decision, made with the mouse.
    fireEvent.click(screen.getByTestId('share-button'));
    expect(field()).toHaveFocus();
    fireEvent(document.body, new PointerEvent('pointerdown', { bubbles: true }));
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share-button')).toHaveFocus();

    // A pointer inside the panel is not: the panel is where the link is, and clicking the link is not
    // a person leaving.
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent(field(), new PointerEvent('pointerdown', { bubbles: true }));
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();
  });

  it('closes from the copied state too, and stops waiting when it does (TC-25)', async () => {
    clipboardThatTakes();
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    await flush();
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();

    // The green tick is a promise about a moment that was cancelled with the panel. Time passes — the
    // moment it was going to expire, and then some — and it does not happen anywhere: not on the
    // button behind the closed panel, and not when the panel is opened again.
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS * 2);
    });
    expect(screen.queryByText('Link copied')).toBeNull();
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
  });

  it('copies the link of the board it was given, whatever else is on the page', () => {
    // A board id that is not this one would be a link to somebody else's board, handed out by a
    // panel that looks entirely correct.
    const other = newBoardId();
    render(<SharePanel boardId={other} />);
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-link')).toHaveValue(boardLink(window.location.origin, other));
  });
});
