// Story 5, task 6: component tests for share.share_panel (TC-22 to TC-25).
// The clipboard is stubbed per test; fake timers drive the LINK_COPIED_MS
// "copied" revert.
//
// TC-22  writeText resolves with the full link; "Link copied" visible at
//        LINK_COPIED_MS - 1, reverted at LINK_COPIED_MS (boundary).
// TC-23  writeText rejects -> input fully selected + manual-copy message.
// TC-24  navigator.clipboard undefined -> same as TC-23.
// TC-25  Escape closes; outside pointerdown closes; focus returns to Share.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const VALID_ID = newBoardId();

type ClipboardMock = { writeText: ReturnType<typeof vi.fn> };

function stubClipboard(clipboard: ClipboardMock | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('share.share_panel (TC-22 to TC-25)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    stubClipboard(undefined);
  });

  it('TC-22: copy resolves -> "Link copied" for LINK_COPIED_MS, then reverts', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    render(<SharePanel boardId={VALID_ID} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });

    const dialog = screen.getByRole('dialog', { name: 'Share board' });
    expect(dialog).not.toBeNull();
    const input = screen
      .getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    const expectedLink = boardLink(window.location.origin, VALID_ID);
    expect(input.value).toBe(expectedLink);
    expect(input.readOnly).toBe(true);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    await flush();

    // writeText got the full link.
    expect(writeText).toHaveBeenCalledWith(expectedLink);
    // "Link copied" is visible at LINK_COPIED_MS - 1...
    expect(screen.getByRole('button', { name: /Link copied/ })).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: /Link copied/ })).not.toBeNull();
    // ...and reverts at LINK_COPIED_MS.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Link copied/ })).toBeNull();
  });

  it('TC-23: writeText rejects -> input fully selected + manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    stubClipboard({ writeText });

    render(<SharePanel boardId={VALID_ID} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    await flush();

    const input = screen
      .getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(input.value).toBe(boardLink(window.location.origin, VALID_ID));
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).not.toBeNull();
    // The link is still shown, and the button is back to "Copy link".
    expect(screen.getByRole('button', { name: 'Copy link' })).not.toBeNull();
  });

  it('TC-24: navigator.clipboard undefined -> manual-copy fallback', async () => {
    stubClipboard(undefined);

    render(<SharePanel boardId={VALID_ID} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    await flush();

    const input = screen
      .getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).not.toBeNull();
  });

  it('TC-25: Escape closes; outside click closes; focus returns to Share', async () => {
    render(<SharePanel boardId={VALID_ID} />);

    // Open, then close on Escape.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    expect(screen.getByRole('dialog', { name: 'Share board' })).not.toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));

    // Open again, then close on an outside pointerdown.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    });
    expect(screen.getByRole('dialog', { name: 'Share board' })).not.toBeNull();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    try {
      act(() => {
        fireEvent.pointerDown(outside);
      });
    } finally {
      outside.remove();
    }
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });
});
