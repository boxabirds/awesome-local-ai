// Story 5 — Share panel (share.share_panel, task 6).
//
// The panel state machine (Open → Copied → Open, and the ManualCopy fallback)
// with a STUBBED navigator.clipboard and fake timers, so the "Link copied"
// boundary (LINK_COPIED_MS − 1 vs exactly LINK_COPIED_MS) is checked to the
// millisecond. A <link-check> wrapper provides the full board link so the
// clipboard receives exactly the address a colleague would paste.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'a1b2c3d4e5f6g7h8i9j0k1';

function setClipboard(clipboard: Clipboard | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
}

async function openPanel() {
  const button = screen.getByTestId('share-button');
  await act(async () => {
    fireEvent.click(button);
  });
  return button;
}

async function copy() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('copy-link'));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', `/b/${BOARD_ID}`);
});

afterEach(() => {
  cleanup();
  setClipboard(undefined);
  vi.useRealTimers();
});

describe('SharePanel (share.copy)', () => {
  // TC-22
  it('TC-22: writeText gets the full link; "Link copied" holds to LINK_COPIED_MS then reverts', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();
    await copy();

    // The clipboard received the FULL board link (pasting opens the same board).
    const expected = `${window.location.origin}/b/${BOARD_ID}`;
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(expected).toBe(boardLink(window.location.origin, BOARD_ID));

    // Still "Link copied" one millisecond BEFORE the window closes.
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('copy-link').textContent).toContain('Link copied');

    // Exactly at LINK_COPIED_MS it reverts to "Copy link".
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('copy-link').textContent).toBe('Copy link');
  });

  // TC-23
  it('TC-23: a rejected writeText selects the whole link and shows the manual-copy message', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    setClipboard({ writeText } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();
    await copy();

    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    // The full value is selected (selectionStart 0 … selectionEnd = length).
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
    expect(screen.getByTestId('manual-copy-message').textContent).toBe(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
  });

  // TC-24
  it('TC-24: a missing clipboard API falls back to manual copy (no writeText)', async () => {
    setClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();
    await copy();

    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(screen.getByTestId('manual-copy-message')).toBeTruthy();
  });

  // TC-25
  it('TC-25: Escape closes the panel and returns focus to the Share button', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    const button = await openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByTestId('share-panel')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('TC-25b: a pointerdown outside the panel closes it', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();
    expect(screen.getByTestId('share-panel')).toBeTruthy();

    await act(async () => {
      // A pointerdown on <body> is outside the panel and the Share button.
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByTestId('share-panel')).toBeNull();
  });

  it('the panel always carries the security note', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) } as unknown as Clipboard);
    render(<SharePanel boardId={BOARD_ID} />);
    await openPanel();
    expect(screen.getByTestId('share-note').textContent).toBe(
      'Anyone with this link can view and edit this board.',
    );
  });
});
