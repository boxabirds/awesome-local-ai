import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { boardPath } from '../../src/client/router';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  ACCESS_NOTE,
  COPIED_LABEL,
  COPY_LABEL,
  MANUAL_COPY_MESSAGE,
  PANEL_TITLE,
} from '../../src/client/share/SharePanel';

/**
 * The Share panel, reached the way a person reaches it (TC-22 to TC-25): rendered as
 * part of a board the app arrived at through a checked link, and opened by clicking
 * `Share`. `SharePanel` is never rendered on its own here, because the thing these
 * tests are for is the panel's own state surviving (or not surviving) being closed and
 * reopened, and that is invisible if the panel is mounted fresh each time.
 *
 * The clipboard is stubbed at the browser's own property, so both of the paths the
 * panel can take are the ones the code takes in a real browser: the API refusing, and
 * the API not existing at all (TC-23, TC-24).
 */

const shareButton = () => screen.getByTestId('share-button');
const copyButton = () => screen.getByTestId('share-copy');
const linkInput = () => screen.getByTestId('share-link') as HTMLInputElement;

/**
 * The copy button as a person hears it: the tick mark the panel adds is `aria-hidden`,
 * so it is not part of the name, and the name is what a screen reader and this test
 * both compare against the strings the panel exports.
 */
const copyLabel = (): string | undefined =>
  screen.queryByRole('button', { name: COPY_LABEL }) !== null
    ? COPY_LABEL
    : screen.queryByRole('button', { name: COPIED_LABEL }) !== null
      ? COPIED_LABEL
      : undefined;

/** What jsdom had for `navigator.clipboard` before this file touched it. */
let clipboardBefore: unknown;

/** Install a clipboard whose `writeText` either resolves or rejects. */
function stubClipboard(writeText: ((link: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

/** The selection a person could copy with Ctrl+C, as jsdom records it. */
function selectionOf(input: HTMLInputElement): string {
  return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
}

beforeEach(() => {
  clipboardBefore = navigator.clipboard;
});

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboardBefore });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Arrive at a board through its link and wait for the board to be there, so the Share
 * button is the board's own. Returns the board id, which is also the address.
 */
async function openBoard(): Promise<string> {
  const boardId = newBoardId();
  window.history.pushState({}, '', boardPath(boardId));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  vi.stubGlobal(
    'WebSocket',
    class {
      binaryType = 'arraybuffer';
      readyState = 0;
      addEventListener(): void {}
      removeEventListener(): void {}
      send(): void {}
      close(): void {}
    },
  );
  render(<App />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(screen.getByTestId('board').getAttribute('data-board-id')).toBe(boardId);
  return boardId;
}

describe('share panel (TC-22 to TC-25)', () => {
  it('TC-22 the button opens a panel that shows the board as a full link', async () => {
    await openBoard();
    expect(screen.queryByTestId('share-panel')).toBeNull();

    fireEvent.click(shareButton());

    const panel = screen.getByTestId('share-panel');
    expect(screen.getByRole('dialog', { name: PANEL_TITLE })).toBe(panel);
    expect(linkInput().readOnly).toBe(true);
    expect(screen.getByText(ACCESS_NOTE)).toBeTruthy();
    expect(copyLabel()).toBe(COPY_LABEL);
    // The address shown is the whole address of this board, and it is the address in
    // the bar: a person comparing the two should find the same thing.
    expect(linkInput().value).toBe(`${window.location.origin}${boardPath(screen.getByTestId('board').getAttribute('data-board-id')!)}`);
    expect(linkInput().value).toBe(window.location.href);
  });

  it('TC-22 copying hands over the full link, says so, and stops saying so after 2s', async () => {
    // Fake timers only after the board is up: arriving at it needs the network flush,
    // and a faked clock would freeze that too.
    await openBoard();
    vi.useFakeTimers();
    const writeText = vi.fn(async (_link: string) => undefined);
    stubClipboard(writeText);
    fireEvent.click(shareButton());

    await act(async () => {
      fireEvent.click(copyButton());
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toBe(window.location.href);
    expect(copyLabel()).toBe(COPIED_LABEL);
    expect(copyButton().textContent).toContain('✓'); // the tick, for the eye
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    // The confirmation is a two-second thing: still there a ms before, gone at the
    // second (boundary), and the panel stays open either way.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(copyLabel()).toBe(COPIED_LABEL);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(copyLabel()).toBe(COPY_LABEL);
    expect(screen.getByTestId('share-panel')).toBeTruthy();
  });

  it('TC-23 a clipboard that refuses says so and leaves the address selected', async () => {
    await openBoard();
    const writeText = vi.fn(async (_link: string) => {
      throw new Error('Document is not focused'); // what Chrome rejects with
    });
    stubClipboard(writeText);
    fireEvent.click(shareButton());

    await act(async () => {
      fireEvent.click(copyButton());
    });

    expect(screen.getByTestId('share-manual').textContent).toBe(MANUAL_COPY_MESSAGE);
    // The label never becomes "Link copied": nothing was copied.
    expect(copyLabel()).toBe(COPY_LABEL);
    // The whole address is selected, which is what makes Ctrl+C enough (TC-29 checks
    // the same selection in a real browser).
    expect(selectionOf(linkInput())).toBe(window.location.href);
    expect(document.activeElement).toBe(linkInput());
  });

  it('TC-24 a browser with no clipboard at all takes the same path', async () => {
    await openBoard();
    stubClipboard(undefined); // no navigator.clipboard
    fireEvent.click(shareButton());

    await act(async () => {
      fireEvent.click(copyButton());
    });

    expect(screen.getByTestId('share-manual').textContent).toBe(MANUAL_COPY_MESSAGE);
    expect(copyLabel()).toBe(COPY_LABEL);
    expect(selectionOf(linkInput())).toBe(window.location.href);
  });

  it('TC-25 Escape and a click outside close it, and the focus is back on Share', async () => {
    await openBoard();
    fireEvent.click(shareButton());
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(shareButton());

    // Reopened, and closed again by clicking anywhere on the board behind it.
    fireEvent.click(shareButton());
    fireEvent.pointerDown(screen.getByTestId('board'), { bubbles: true });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(shareButton());

    // Reopened once more: the panel is empty of last time's answer, because a label
    // reading "Link copied" would be a claim about this visit.
    fireEvent.click(shareButton());
    expect(copyLabel()).toBe(COPY_LABEL);
    expect(screen.queryByTestId('share-manual')).toBeNull();
    // Its own button closes it too.
    fireEvent.click(screen.getByTestId('share-close'));
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('TC-25 a click inside the panel does not close it, and selects the address', async () => {
    await openBoard();
    fireEvent.click(shareButton());
    const input = linkInput();

    fireEvent.pointerDown(input);
    fireEvent.click(input);
    expect(screen.getByTestId('share-panel')).toBeTruthy();
    expect(selectionOf(input)).toBe(window.location.href);
  });
});
