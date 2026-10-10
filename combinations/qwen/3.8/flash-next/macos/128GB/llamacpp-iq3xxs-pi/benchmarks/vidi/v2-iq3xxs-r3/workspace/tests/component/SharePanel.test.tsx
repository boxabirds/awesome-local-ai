/**
 * Component tests for the share panel (TC-22 to TC-25).
 *
 * The panel is one of the few places where success depends on something outside
 * the page — the clipboard — so all three things it can meet are forced here: a
 * clipboard that takes the text, one that refuses, and no clipboard at all.
 * Clipboard permission behaviour differs between browsers, which is exactly why
 * both paths are forced deterministically instead of being discovered in an e2e
 * run (design: share.share_panel).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { COMPONENT_BOARD_ID } from './helpers/board';

/** A clipboard we can watch: every `writeText` is recorded and answered. */
interface FakeClipboard {
  readonly texts: string[];
  writeText(text: string): Promise<void>;
}

function clipboardThatTakes(): FakeClipboard {
  const texts: string[] = [];
  return {
    texts,
    writeText: (text: string) => {
      texts.push(text);
      return Promise.resolve();
    },
  };
}

function clipboardThatRefuses(): FakeClipboard {
  const texts: string[] = [];
  return {
    texts,
    writeText: (text: string) => {
      texts.push(text);
      return Promise.reject(new Error('Document is not focused'));
    },
  };
}

/** The clipboard the panel finds when it looks; `undefined` means there is none. */
function withClipboard(clipboard: FakeClipboard | undefined): void {
  Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true });
}

const field = (): HTMLInputElement => screen.getByTestId('share-link') as HTMLInputElement;

/**
 * Let the clipboard's answer arrive. `writeText` is answered by a promise, so the
 * panel's reaction lands a microtask after the click — and a rejected promise
 * takes one more to reach the `catch`.
 */
async function answered(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The link field's own selection: "fully selected" is a fact about the field. */
function selectedLink(): { text: string; whole: boolean; focused: boolean } {
  const input = field();
  const start = input.selectionStart ?? -1;
  const end = input.selectionEnd ?? -1;
  return {
    text: input.value.slice(start, end),
    whole: start === 0 && end === input.value.length,
    focused: document.activeElement === input,
  };
}

/** Open the panel, as a person would. */
function openPanel(): void {
  fireEvent.click(screen.getByTestId('share-button'));
}

/** The panel is open: the dialog the design names, with its accessible name. */
function expectOpen(): void {
  expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
  expect(screen.getByTestId('share-panel')).toBeTruthy();
}

function expectClosed(): void {
  expect(screen.queryByTestId('share-panel')).toBeNull();
}

beforeEach(() => {
  withClipboard(clipboardThatTakes());
});

afterEach(() => {
  // This suite renders one panel per test, so the last one has to go: several
  // panels on the page would answer every query twice.
  cleanup();
  withClipboard(undefined);
  vi.useRealTimers();
});

describe('copying the link (TC-22)', () => {
  it('shows the link, and puts exactly that link on the clipboard', async () => {
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    // Nothing is offered, and nothing is asked of the clipboard, before the panel
    // is opened: a board that is merely being looked at copies nothing.
    expectClosed();
    const clipboard = (window.navigator as unknown as { clipboard: FakeClipboard }).clipboard;

    openPanel();
    expectOpen();
    expect(clipboard.texts).toEqual([]);
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );

    const input = field();
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(boardLink(COMPONENT_BOARD_ID));
    // Absolute, or a link pasted into a chat opens nothing at all.
    expect(input.value).toMatch(/^https?:\/\/[^/]+\/b\/[A-Za-z0-9_-]{22}$/);

    fireEvent.click(screen.getByTestId('share-copy'));
    expect(clipboard.texts).toEqual([input.value]);
    await answered();
    expect(screen.getByTestId('share-copy').textContent).toBe('Link copied');
  });

  it('says "Link copied" only for as long as that is true', async () => {
    vi.useFakeTimers();
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    // The clipboard answers on a promise, so the panel updates a microtask later.
    await answered();
    expect(screen.getByTestId('share-copy').textContent).toBe('Link copied');
    // One millisecond short of the setting it keeps saying it… (`act`, because
    // the timer's state update reaches the DOM a microtask later).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('share-copy').textContent).toBe('Link copied');
    // …and it stops at the moment the copy is a LINK_COPIED_MS ago.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy link');
  });
});

describe('when the clipboard will not cooperate (TC-23, TC-24)', () => {
  it('selects the whole link and says what to press when the clipboard refuses', async () => {
    withClipboard(clipboardThatRefuses());
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    await answered();

    // The refusal is not shown as an error: the link is *already selected*, so
    // Ctrl+C is all that is left, and the panel says that in those words.
    expect(screen.getByTestId('share-manual').textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
    const selection = selectedLink();
    expect(selection.whole).toBe(true);
    expect(selection.text).toBe(boardLink(COMPONENT_BOARD_ID));
    expect(selection.focused).toBe(true);
    // And it is still the same board, untouched by any of this.
    expect(screen.getByTestId('share-link').textContent).toBe('');
  });

  it('does the same when there is no clipboard to ask', async () => {
    withClipboard(undefined);
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    await answered();
    expect(screen.getByTestId('share-manual').textContent).toBe('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(selectedLink().whole).toBe(true);
  });

  it('keeps the panel open, with the note, so the link can be read out too', async () => {
    withClipboard(undefined);
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    fireEvent.click(screen.getByTestId('share-copy'));
    await answered();
    expectOpen();
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );
    // The button does not claim a copy that did not happen.
    expect(screen.getByTestId('share-copy').textContent).toBe('Copy link');
  });
});

describe('closing the panel (TC-25)', () => {
  it('closes on Escape and hands the focus back to the Share button', () => {
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    expectOpen();
    fireEvent.keyDown(document, { key: 'Escape' });
    expectClosed();
    // Focus goes back where the person was looking, so Tab continues from there.
    expect(document.activeElement).toBe(screen.getByTestId('share-button'));
  });

  it('closes when the click is somewhere else on the board', () => {
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    // A click inside the panel keeps it up — selecting the link is a click too.
    fireEvent.mouseDown(screen.getByTestId('share-copy'));
    expectOpen();
    fireEvent.mouseDown(document.body);
    expectClosed();
  });

  it('closes when Share is clicked again', () => {
    render(<SharePanel boardId={COMPONENT_BOARD_ID} />);
    openPanel();
    expectOpen();
    fireEvent.click(screen.getByTestId('share-button'));
    expectClosed();
  });
});
