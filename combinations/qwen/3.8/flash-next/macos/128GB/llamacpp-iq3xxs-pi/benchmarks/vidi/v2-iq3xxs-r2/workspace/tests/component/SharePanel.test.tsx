import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COPY_LINK_LABEL,
  LINK_COPIED_LABEL,
  MANUAL_COPY_MESSAGE,
  SHARE_BUTTON_LABEL,
  SHARE_NOTE,
  SHARE_PANEL_LABEL,
} from '../../src/client/share/SharePanel';
import { boardLink } from '../../src/client/router';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { renderBoard } from './fixtures/board';

/**
 * The Share panel (`share.share_panel`), including both clipboard paths.
 *
 * `share.copy` and `share.copy_fallback` are the two halves of one button, and which one
 * you get depends on the browser's clipboard policy — which is exactly why both are
 * forced here, so that neither is a story told by whichever browser happens to be
 * running the end-to-end suite.
 */

/** The link the panel should be showing for this board. */
function expectedLink(boardId: string): string {
  return boardLink(window.location.origin, boardId);
}

/** Give (or refuse) this test a clipboard that writes. */
function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

/** This browser has no clipboard API at all. */
function withoutClipboard(): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  withoutClipboard();
});

/** Let the promise a click started settle and React re-render, without touching timers. */
async function settlePromise(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openPanel(): void {
  fireEvent.click(screen.getByTestId('share-button'));
}

function linkField(): HTMLInputElement {
  return screen.getByTestId('share-link') as HTMLInputElement;
}

function copyButton(): HTMLButtonElement {
  return screen.getByTestId('copy-link') as HTMLButtonElement;
}

/**
 * The fallback's request. Queried by test id because the board already has two live
 * regions (`role="status"`) announcing connection and zoom, and this is the third.
 */
function manualCopyMessage(): string | null {
  return screen.getByTestId('manual-copy-message').textContent;
}

/** Move the clock, and let whatever the clock caused reach the screen. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function selectionOfField(input: HTMLInputElement): string {
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  return input.value.slice(start, end);
}

describe('copying the link (TC-22, TC-23, TC-24)', () => {
  it('TC-22 Copy link writes the full link and says so for exactly LINK_COPIED_MS', async () => {
    const boardId = await renderBoard();
    const written: string[] = [];
    stubClipboard(async (text: string) => {
      written.push(text);
    });

    // Fake timers before the button is pressed: the confirmation's timer is started by the
    // render that follows the click, and a timer started by the real clock would never be
    // reachable by advancing a fake one.
    vi.useFakeTimers();
    try {
      openPanel();
      // The panel shows the whole link, read-only, and says what a link is worth.
      expect(linkField().value).toBe(expectedLink(boardId));
      expect(linkField().readOnly).toBe(true);
      expect(screen.getByTestId('share-note').textContent).toBe(SHARE_NOTE);
      expect(screen.getByRole('dialog', { name: SHARE_PANEL_LABEL })).toBeTruthy();
      expect(copyButton().textContent).toBe(COPY_LINK_LABEL);

      fireEvent.click(copyButton());
      await settlePromise();
      expect(written).toEqual([expectedLink(boardId)]);
      expect(copyButton().textContent).toContain(LINK_COPIED_LABEL);

      // The boundary of the confirmation: still "Link copied" a millisecond before the
      // setting, and gone at the setting itself. 2 seconds is long to be uncertain about,
      // and a real one would drift.
      await advance(LINK_COPIED_MS - 1);
      expect(copyButton().textContent).toContain(LINK_COPIED_LABEL);
      expect(screen.getByTestId('share-panel')).toBeTruthy();
      await advance(1);
      expect(copyButton().textContent).toBe(COPY_LINK_LABEL);
      // The panel is still open: the confirmation wears off, the way to copy does not.
      expect(screen.getByTestId('share-panel')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('TC-23 a clipboard that refuses selects the link and asks for Ctrl+C', async () => {
    const boardId = await renderBoard();
    const attempted: string[] = [];
    stubClipboard(async (text: string) => {
      attempted.push(text);
      throw new Error('NotAllowedError: the document is not allowed to use the Clipboard API');
    });

    openPanel();
    fireEvent.click(copyButton());
    await settlePromise();

    expect(attempted).toEqual([expectedLink(boardId)]);
    expect(manualCopyMessage()).toBe(MANUAL_COPY_MESSAGE);
    // The whole link is selected in the field, and the field has the keyboard.
    const input = linkField();
    expect(selectionOfField(input)).toBe(expectedLink(boardId));
    expect(document.activeElement).toBe(input);
    expect(copyButton().textContent).toBe(COPY_LINK_LABEL);
  });

  it('TC-24 a browser with no clipboard API at all does the same thing', async () => {
    const boardId = await renderBoard();
    withoutClipboard();

    openPanel();
    fireEvent.click(copyButton());
    await settlePromise();

    expect(manualCopyMessage()).toBe(MANUAL_COPY_MESSAGE);
    const input = linkField();
    expect(selectionOfField(input)).toBe(expectedLink(boardId));
    expect(document.activeElement).toBe(input);
  });
});

describe('closing the panel (TC-25)', () => {
  it('TC-25 Escape closes it, and the keyboard goes back to the Share button', async () => {
    await renderBoard();
    openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(linkField(), { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(screen.getByTestId('share-button').textContent).toBe(SHARE_BUTTON_LABEL);
    expect(document.activeElement).toBe(screen.getByTestId('share-button'));
  });

  it('TC-25 a pointer down outside the panel closes it too', async () => {
    await renderBoard();
    openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // Anywhere else on the board: the panel is a detour, and the board is where you go back to.
    fireEvent.pointerDown(screen.getByTestId('viewport'));
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('share-button'));
  });

  it('a click inside the field selects the whole link, and does not close the panel', async () => {
    const boardId = await renderBoard();
    openPanel();
    const input = linkField();
    input.setSelectionRange(3, 3);
    fireEvent.click(input);
    expect(selectionOfField(input)).toBe(expectedLink(boardId));
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });
});
