/**
 * Component tests for the Share panel (design `share.share_panel`: TC-22 to TC-25).
 *
 * The clipboard is the boundary under test, and it is the one browser API in this story that
 * a test cannot rely on: it is missing on a non-secure origin, it is present and refused
 * under some permissions, and it works in others. So it is stubbed here and *every* case is
 * forced - allowed, rejected, absent - because the panel has to do something useful in all
 * three, and "the browser was the reason" is not something the person holding a board link
 * can be told.
 *
 * The clock is fake for the same reason as everywhere else: "Link copied" lasting
 * `LINK_COPIED_MS` is a promise about time, and a promise about time is tested by turning
 * the time, including the two sides of the boundary (`LINK_COPIED_MS - 1`, exactly
 * `LINK_COPIED_MS`).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARE_NOTE, SharePanel, boardLink } from '../../src/client/share/SharePanel.js';
import { newBoardId } from '../../src/shared/board-id.js';
import { LINK_COPIED_MS } from '../../src/shared/config.js';

/** The clocks the panel uses. `requestAnimationFrame` is not faked (see `setup.ts`). */
/** The clocks the panel uses. `requestAnimationFrame` is not faked here, because the suite setup owns the frame queue (see setup.ts). */
const panelTimers: Parameters<(typeof vi)['useFakeTimers']>[0] = {
  toFake: ['setTimeout', 'clearTimeout', 'Date'],
};

/** jsdom's origin, which is the origin the panel has to build the link from. */
const ORIGIN = window.location.origin;

const clipboardDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');

/** Install a clipboard that behaves the way a test needs. */
function withClipboard(stub: { writeText?(text: string): Promise<void> } | null): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(
    stub?.writeText ??
      (() =>
        Promise.resolve()),
  );
  if (stub === null) {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  } else {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  }
  return writeText;
}

const open = (): void => {
  fireEvent.click(screen.getByTestId('share-button'));
};

const panel = (): HTMLElement | null => screen.queryByTestId('share-panel');
const linkField = (): HTMLInputElement =>
  screen.getByTestId('share-link') as unknown as HTMLInputElement;
const copyButton = (): HTMLElement => screen.getByTestId('copy-link-button');
const copied = (text: string): boolean => (copyButton().textContent ?? '').includes(text);

/** The selected part of the link field, which is what Ctrl+C would copy. */
const selection = (): string => {
  const field = linkField();
  return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
};

const focused = (): Element | null => document.activeElement;

let id: string;
let link: string;

beforeEach(() => {
  vi.useFakeTimers(panelTimers);
  id = newBoardId();
  link = boardLink(ORIGIN, id);
  withClipboard({});
  act(() => {
    render(<SharePanel boardId={id} />);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // jsdom's own Navigator, so a test that comes after is not testing this one's clipboard.
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  if (clipboardDescriptor) {
    Object.defineProperty(Navigator.prototype, 'clipboard', clipboardDescriptor);
  }
});

describe('the Share button and its panel', () => {
  it('is a button on the board before it is anything else', () => {
    const button = screen.getByTestId('share-button');
    expect(button.textContent).toBe('Share');
    expect(panel()).toBeNull();
  });

  it('builds the link from the origin and the board id', () => {
    expect(boardLink('https://vidi6.example', id)).toBe(`https://vidi6.example/b/${id}`);
    open();
    expect(linkField().value).toBe(link);
  });

  it('opens a dialog that says what the link means', () => {
    open();

    const dialog = panel();
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-label')).toBe('Share board');

    expect(linkField().readOnly).toBe(true);
    expect(linkField().getAttribute('readonly')).not.toBeNull();
    expect(copyButton().textContent).toBe('Copy link');
    // The security model, in the panel where the decision about the link is being made.
    expect(screen.getByTestId('share-note').textContent).toBe(SHARE_NOTE);
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );
  });

  it('closes again when the button is pressed a second time', () => {
    open();
    expect(panel()).not.toBeNull();
    open();
    expect(panel()).toBeNull();
  });
});

describe('copy link (TC-22)', () => {
  it('puts the whole link on the clipboard and confirms it for LINK_COPIED_MS', async () => {
    const writeText = withClipboard({});
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(writeText).toHaveBeenCalledWith(link);
    expect(copied('Link copied')).toBe(true);

    // Both sides of the boundary: still confirmed one millisecond before it is due, gone
    // on the millisecond it is.
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(copied('Link copied')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(copied('Link copied')).toBe(false);
    expect(copyButton().textContent).toBe('Copy link');
  });

  it('starts the two seconds again when asked to copy again', async () => {
    withClipboard({});
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 500);
    });
    expect(copied('Link copied')).toBe(true);

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    // A copy two seconds ago is not confirmed a third time, but a copy 500 ms ago is.
    expect(copied('Link copied')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(501);
    });
    expect(copied('Link copied')).toBe(false);
  });

  it('is not confirming anything once the panel has been closed and opened', async () => {
    withClipboard({});
    open();
    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(copied('Link copied')).toBe(true);

    fireEvent.keyDown(screen.getByTestId('share-panel'), { key: 'Escape' });
    open();

    expect(copyButton().textContent).toBe('Copy link');
  });

  it('selects the link in the field when the field is clicked', () => {
    open();
    const field = linkField();
    // The panel opens with the link already selected; clicking it again must not lose it.
    field.setSelectionRange(0, 0);
    fireEvent.click(field);
    expect(selection()).toBe(link);
  });
});

describe('copy link when the browser will not copy (TC-23, TC-24)', () => {
  it('offers the link for a manual copy when the clipboard refuses it', async () => {
    withClipboard({
      writeText: () => Promise.reject(new Error('NotAllowedError: permission denied')),
    });
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('share-manual').textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(copied('Link copied')).toBe(false);
    // The link is selected and the field has focus, so the keystroke the message asks for
    // lands on something that holds the link.
    expect(selection()).toBe(link);
    expect(focused()).toBe(linkField());
  });

  it('offers the link for a manual copy when the browser has no clipboard at all', async () => {
    withClipboard(null);
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('share-manual').textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(selection()).toBe(link);
    expect(focused()).toBe(linkField());
  });

  it('says nothing about a clipboard that throws on the spot instead of rejecting', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => {
          throw new Error('undefined is not an object');
        },
      },
    });
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('share-manual').textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(selection()).toBe(link);
  });

  it('confirms the copy when a clipboard that refused later accepts it', async () => {
    let allowed = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => (allowed ? Promise.resolve() : Promise.reject(new Error('denied'))),
      },
    });
    open();

    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId('share-manual')).toBeInTheDocument();

    allowed = true;
    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(copied('Link copied')).toBe(true);
    expect(screen.queryByTestId('share-manual')).toBeNull();
  });
});

describe('closing the panel (TC-25)', () => {
  it('closes on Escape and gives the keyboard back to the Share button', () => {
    open();
    expect(panel()).not.toBeNull();

    fireEvent.keyDown(screen.getByTestId('share-panel'), { key: 'Escape' });

    expect(panel()).toBeNull();
    expect(focused()).toBe(screen.getByTestId('share-button'));
  });

  it('closes on a click outside itself, wherever that click was', () => {
    open();
    expect(panel()).not.toBeNull();

    // The board is what is behind the panel, so that is where the click outside it goes.
    fireEvent.pointerDown(document.body);

    expect(panel()).toBeNull();
    expect(focused()).toBe(screen.getByTestId('share-button'));
  });

  it('stays open when the click is inside it', () => {
    open();

    fireEvent.pointerDown(screen.getByTestId('share-note'));

    expect(panel()).not.toBeNull();
  });

  it('closes on Escape even from the link field, which is where the focus is', () => {
    open();
    expect(focused()).toBe(linkField());

    fireEvent.keyDown(linkField(), { key: 'Escape' });

    expect(panel()).toBeNull();
  });

  it('forgets its timers when it goes away, and starts clean when it comes back', async () => {
    withClipboard({});
    open();
    fireEvent.click(copyButton());
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(copied('Link copied')).toBe(true);

    // A confirmation timer that outlived the panel would relabel a button that is not
    // showing a confirmation.
    fireEvent.keyDown(screen.getByTestId('share-panel'), { key: 'Escape' });
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS * 2);
    });
    open();
    expect(copyButton().textContent).toBe('Copy link');
  });
});
