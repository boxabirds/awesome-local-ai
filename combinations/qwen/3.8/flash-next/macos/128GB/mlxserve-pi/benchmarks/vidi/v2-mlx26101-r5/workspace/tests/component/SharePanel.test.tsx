/**
 * TC-22, TC-23, TC-24, TC-25: handing a link to somebody else, in a browser that may or may not
 * let us.
 *
 * The clipboard is the part of this that is not ours to rely on. It is missing outside secure
 * contexts, it is refused by people who have read about clipboard permission, and it goes away
 * mid-click in browsers that allow a tab to be backgrounded. So the interesting thing about these
 * tests is not that copying works — it is what the panel does when it does not: the link stays on
 * screen, goes under the person's hands, and the panel says how to take it (`share.copy_fallback`).
 * A "Copy failed" message would be a sentence about our tools; the manual-copy message is a
 * sentence about theirs.
 *
 * `LINK_COPIED_MS` is a promise about how long a confirmation stays true, so it is tested with the
 * clock held: the moment before it expires and the moment it does.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SharePanel,
  boardLink,
  COPY_LINK_LABEL,
  LINK_COPIED_MESSAGE,
  MANUAL_COPY_MESSAGE,
  SHARE_LABEL,
  SHARE_NOTE,
} from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

/** The board being shared, and the address of the site it is served from. */
const BOARD_ID = newBoardId();
const ORIGIN = 'https://vidi6.app';
const LINK = `https://vidi6.app/b/${BOARD_ID}`;

/** Opens the panel, which is the step before every one of these cases. */
function open(): void {
  fireEvent.click(screen.getByTestId('share-button'));
}

/** Clicks the button that asks for the clipboard. */
function copy(): void {
  fireEvent.click(screen.getByTestId('copy-link'));
}

/** The text a person has under their hands, if the field will say. */
function selectedText(el: HTMLInputElement): string {
  return el.selectionStart === 0 && el.selectionEnd === el.value.length ? el.value : '';
}

/** Lets the copy promise resolve, and whatever the page did after it land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
  });
}

/** Says what the clipboard does, and puts it back afterwards. */
function withClipboard(value: unknown, run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(Navigator.prototype, 'clipboard', descriptor);
    else Reflect.deleteProperty(window.navigator, 'clipboard');
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Share button and the link it shows (TC-22)', () => {
  it('is a button until it is asked to be a panel', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);

    expect(screen.getByTestId('share-button').textContent).toBe(SHARE_LABEL);
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('shows the whole link, as text, before anything is copied', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
    open();

    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    // Not only on the clipboard: a person who cannot see what was copied cannot check it.
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(screen.getByTestId('share-note').textContent).toBe(SHARE_NOTE);
    expect(screen.getByTestId('copy-link').textContent).toBe(COPY_LINK_LABEL);
  });

  it('takes the link from the address the page is really served from', () => {
    // No `origin` given, which is how the board renders it: the copied text has to be the address
    // somebody else can open, not a path.
    render(<SharePanel boardId={BOARD_ID} />);
    open();

    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/b/${BOARD_ID}`);
    expect(field.value.startsWith('http')).toBe(true);
    expect(boardLink('https://vidi6.app/', BOARD_ID)).toBe(LINK);
    expect(boardLink('https://vidi6.app', BOARD_ID)).toBe(LINK);
  });

  it('copies the full link, and says so for exactly as long as it is true', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText }, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });

    await settle();

    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByTestId('copy-link').textContent).toBe(`${LINK_COPIED_MESSAGE} ✓`);

    // One millisecond short of the promise, the message is still up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link').textContent).toBe(`${LINK_COPIED_MESSAGE} ✓`);

    // And at the moment it stops being true, it goes: the button is the button again, ready to be
    // honest about a link that may have changed since.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('copy-link').textContent).toBe(COPY_LINK_LABEL);
  });

  it('says it again when it is asked again', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText }, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS);
    });

    withClipboard({ writeText }, copy);
    await settle();

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('copy-link').textContent).toBe(`${LINK_COPIED_MESSAGE} ✓`);
  });
});

describe('the clipboard we cannot use (TC-23, TC-24)', () => {
  it('puts the link under the person’s hands when the clipboard says no', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('NotAllowedError: not allowed', 'NotAllowedError');
    });
    withClipboard({ writeText }, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });

    await settle();

    expect(screen.getByTestId('share-status').textContent).toBe(MANUAL_COPY_MESSAGE);
    // The whole link, selected, focused: `Ctrl+C` is a complete sentence from here.
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(selectedText(field)).toBe(LINK);
    expect(document.activeElement).toBe(field);
    // The panel is still open, and the button is still there: nothing was lost by the refusal.
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(screen.getByTestId('copy-link').textContent).toBe(COPY_LINK_LABEL);
  });

  it('does the same when there is no clipboard at all', async () => {
    // `navigator.clipboard` is missing outside secure contexts, which is a real browser on a real
    // board served over a plain http address.
    withClipboard(undefined, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });

    await settle();

    expect(screen.getByTestId('share-status').textContent).toBe(MANUAL_COPY_MESSAGE);
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(selectedText(field)).toBe(LINK);
    expect(document.activeElement).toBe(field);
  });

  it('does the same when the clipboard is an object with nothing on it', async () => {
    // A `clipboard` that cannot write is not a clipboard, and promising a copy it cannot do is
    // worse than admitting it cannot.
    withClipboard({}, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });

    await settle();

    expect(screen.getByTestId('share-status').textContent).toBe(MANUAL_COPY_MESSAGE);
    expect(selectedText(screen.getByTestId('share-link-field') as HTMLInputElement)).toBe(LINK);
  });

  it('says nothing about a failure of our own making', () => {
    // The words are instructions, not a diagnosis: no "failed", no exception, nothing about us.
    expect(MANUAL_COPY_MESSAGE.toLowerCase()).not.toContain('fail');
    expect(MANUAL_COPY_MESSAGE.toLowerCase()).not.toContain('error');
    expect(MANUAL_COPY_MESSAGE).toContain('Cmd+C');
  });
});

describe('closing the panel (TC-25)', () => {
  it('closes when the person presses Escape', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
    open();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share-button').textContent).toBe(SHARE_LABEL);
  });

  it('closes when the person clicks anywhere else, including on the board behind it', () => {
    render(
      <>
        <div data-testid="board-behind" />
        <SharePanel boardId={BOARD_ID} origin={ORIGIN} />
      </>,
    );
    open();

    fireEvent.mouseDown(screen.getByTestId('board-behind'));

    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('closes when the person clicks the Share button again', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
    open();

    fireEvent.click(screen.getByTestId('share-button'));

    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('says nothing about the last copy when it is opened again', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText }, () => {
      render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });
    await settle();
    expect(screen.getByTestId('copy-link').textContent).toBe(`${LINK_COPIED_MESSAGE} ✓`);

    // Closed, and opened again: a confirmation is about a click that happened, and this panel has
    // not had one yet.
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    open();

    expect(screen.getByTestId('copy-link').textContent).toBe(COPY_LINK_LABEL);
    expect(screen.getByTestId('share-status').textContent).toBe('');
  });

  it('does not let a confirmation outlive the panel it was for', async () => {
    const writeText = vi.fn(async () => {});
    const complained = vi.spyOn(console, 'error').mockImplementation(() => {});
    let view!: { unmount(): void };
    withClipboard({ writeText }, () => {
      view = render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
      open();
      copy();
    });
    await settle();

    // The panel goes away with a timer still counting down on it; the timer must not try to speak.
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS * 2);
    });

    expect(complained).not.toHaveBeenCalled();
    complained.mockRestore();
  });

  it('leaves the board alone while it does all of this', () => {
    // Nothing the panel does may reach the board: no zoom, no selection, no edit. It is a layer
    // over a board that a person may be in the middle of typing into.
    render(
      <>
        <div data-testid="board-behind">
          <span data-testid="note-underneath">something being typed</span>
        </div>
        <SharePanel boardId={BOARD_ID} origin={ORIGIN} />
      </>,
    );
    open();
    copy();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(screen.getByTestId('note-underneath').textContent).toBe('something being typed');
  });
});

/**
 * The button that opens the panel stays inside the panel's own wrapper when it opens.
 *
 * This is the shape of the tree, not a behaviour, and it is tested because getting it wrong is a
 * bug that only happens in a real browser. The panel closes on a click outside itself, and the
 * click that opens it is still on its way to the document while the panel is being built: if the
 * open state is a *different* tree, the button that was clicked is no longer inside the wrapper by
 * the time the panel's own listener exists, the opening click reads as an outside click, and the
 * panel closes itself in the millisecond it appeared in. That is what it did, until TC-26 opened one
 * in Chromium and it was not there.
 *
 * jsdom gives events to the document before React has built anything, so no component test here can
 * see the bug. What it can see is the condition that makes the bug impossible, which is what this
 * holds in place.
 */
describe('the panel and the button that opened it', () => {
  it('keeps the button it was opened by inside itself', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
    const trigger = screen.getByTestId('share-button');
    fireEvent.click(trigger);

    const wrapper = screen.getByTestId('share');
    // The same element that was clicked, still inside the thing the outside-click rule measures by.
    expect(wrapper.contains(trigger)).toBe(true);
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(screen.getByTestId('share-link-field')).toBeTruthy();
  });

  it('is the same button before, during and after, and it closes the panel it opened', () => {
    render(<SharePanel boardId={BOARD_ID} origin={ORIGIN} />);
    const trigger = screen.getByTestId('share-button');
    fireEvent.click(trigger);
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Pressing it again is the third way out of a panel, and it is the same button doing it.
    fireEvent.click(trigger);
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share')).toBe(trigger.parentElement);
  });
});
