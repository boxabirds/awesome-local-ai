/**
 * The Share panel (share.copy, share.copy_fallback) with the clipboard stubbed.
 * Clipboard permission behaviour differs per browser, so both the allowed path
 * and the refused paths are forced here on purpose rather than left to whatever
 * a given browser happens to allow (design: Mock vs real — clipboard is stubbed
 * in ui-component, real only in the Chromium e2e).
 *
 * Spec: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
 * section "Share panel" (TC-22, TC-23, TC-24, TC-25).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { boardLink, SharePanel } from '../../src/client/share/SharePanel';

/** Let an already-settled clipboard promise reach its then/catch. */
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const setClipboard = (value: { writeText?: (text: string) => Promise<void> } | undefined): void => {
  Object.defineProperty(navigator, 'clipboard', {
    value: value as unknown as Clipboard,
    configurable: true,
  });
};

let boardId = '';
const link = (): string => boardLink(window.location.origin, boardId);

const shareButton = (): HTMLButtonElement =>
  screen.getByTestId('share-button') as HTMLButtonElement;
const panel = (): HTMLElement | null => screen.queryByTestId('share-panel');
const copyButton = (): HTMLButtonElement =>
  screen.getByTestId('copy-link-button') as HTMLButtonElement;
const linkField = (): HTMLInputElement =>
  screen.getByTestId('share-link-field') as HTMLInputElement;

const openPanel = (): void => {
  fireEvent.click(shareButton());
};

beforeEach(() => {
  vi.useFakeTimers();
  boardId = newBoardId();
  window.history.replaceState(null, '', `/b/${boardId}`);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('copying the board link (share.copy)', () => {
  // TC-22
  it('copies the full link and confirms it for exactly LINK_COPIED_MS (TC-22)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<SharePanel boardId={boardId} />);
    openPanel();
    expect(linkField().value).toBe(link());

    fireEvent.click(copyButton());
    expect(writeText).toHaveBeenCalledWith(link());
    // The write resolves; the confirmation comes up.
    await flush();
    expect(copyButton().textContent).toContain('Link copied');

    // It is still up one millisecond short of the setting, and gone on it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(copyButton().textContent).toContain('Link copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(copyButton().textContent).toBe('Copy link');
  });
});

describe('the clipboard refuses (share.copy_fallback)', () => {
  // TC-23: the write is refused — select the link and tell the person.
  it('selects the whole link and shows the manual-copy message when refused (TC-23)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'));
    setClipboard({ writeText });

    render(<SharePanel boardId={boardId} />);
    openPanel();
    fireEvent.click(copyButton());
    await flush();

    expect(screen.getByTestId('manual-copy-hint').textContent).toBe(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    const field = linkField();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(field.value).toBe(link());
  });

  // TC-24: no clipboard at all — the very same fallback.
  it('falls back the same way when there is no clipboard API (TC-24)', async () => {
    setClipboard(undefined);

    render(<SharePanel boardId={boardId} />);
    openPanel();
    fireEvent.click(copyButton());
    await flush();

    expect(screen.getByTestId('manual-copy-hint').textContent).toBe(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    const field = linkField();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});

describe('closing the share panel', () => {
  // TC-25
  it('closes on Escape and on a click outside the panel (TC-25)', () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });

    const { unmount } = render(<SharePanel boardId={boardId} />);
    openPanel();
    expect(panel()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).toBeNull();

    openPanel();
    expect(panel()).not.toBeNull();
    // A press outside the panel: on the document, not on the panel or its button.
    fireEvent.pointerDown(window.document.body);
    expect(panel()).toBeNull();
    unmount();
  });
});
