// Share panel (spec: share.share_panel, TC-22 to TC-25).
//
// The jsdom URL is a secure origin (https://localhost/) so that
// navigator.clipboard exists by default; the "clipboard unavailable" test
// (TC-23) deletes it. The board link is therefore
// https://localhost/b/<id>.
//
// (jest-dom is unavailable in this offline environment: presence is asserted
// with getBy* (which throws when absent) and absence with query*.)

/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { click, dispatch, windowKey } from './helpers';

const BOARD_ID = newBoardId();
const LINK = boardLink('https://localhost', BOARD_ID);

/** Replace navigator.clipboard with a stub whose writeText is `write`. */
function stubClipboard(write: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(write) },
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('share.share_panel', () => {
  it('TC-22: closed → open shows the link + "Copy link"; copy → "Link copied" (+tick) for LINK_COPIED_MS', async () => {
    stubClipboard(async () => {});
    render(<SharePanel boardId={BOARD_ID} />);

    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(LINK);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();

    click(screen.getByRole('button', { name: 'Copy link' }));
    // writeText is async; let the promise settle.
    await act(async () => {});
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(document.querySelector('.copied-tick')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-23: no clipboard → manual hint, input selected, no crash', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });
    render(<SharePanel boardId={BOARD_ID} />);

    click(screen.getByRole('button', { name: 'Share' }));
    click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {});

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-24: clipboard write fails → manual hint, input selected', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    render(<SharePanel boardId={BOARD_ID} />);

    click(screen.getByRole('button', { name: 'Share' }));
    click(screen.getByRole('button', { name: 'Copy link' }));
    await act(async () => {});

    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-25: Escape closes (focus back on Share); pointerdown outside closes', async () => {
    stubClipboard(async () => {});

    // Escape closes and returns focus to the Share button.
    const first = render(<SharePanel boardId={BOARD_ID} />);
    click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    windowKey('Escape');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
    first.unmount();

    // A pointerdown outside the panel (and outside the button) closes it.
    render(<SharePanel boardId={BOARD_ID} />);
    const shareButton = screen.getByRole('button', { name: 'Share' });
    click(shareButton);
    expect(screen.getByRole('dialog')).toBeTruthy();
    dispatch(document.body, new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
