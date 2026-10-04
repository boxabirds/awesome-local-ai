/**
 * Story 5 Share panel component tests (share.copy):
 * - TC-22 Copy link → "Link copied" (writeText called with the full link)
 *   → reverts to "Copy link" after LINK_COPIED_MS.
 * - TC-23 Escape closes the panel.
 * - TC-24 Click outside closes the panel and returns focus to the Share
 *   button.
 * - TC-25 Clicking inside the panel keeps it open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'aB3dE6gH9jK2mN5pQ8rS1t';

function installClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(writeText);
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: fn },
    configurable: true,
  });
  return fn;
}

describe('share.copy (SharePanel)', () => {
  beforeEach(() => {
    window.history.pushState(null, '', `/b/${BOARD_ID}`);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-22: Copy link → "Link copied" → reverts after LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    const writeText = installClipboard(() => Promise.resolve());

    render(<SharePanel boardId={BOARD_ID} />);
    const shareBtn = screen.getByRole('button', { name: 'Share' });
    fireEvent.click(shareBtn);

    const panel = screen.getByRole('dialog', { name: 'Share board' });
    expect(panel).toBeVisible();

    // The input is read-only and holds the full link.
    const input = screen.getByTestId('share-link-input');
    const fullLink = boardLink(window.location.origin, BOARD_ID);
    expect(input).toHaveAttribute('readonly');
    expect(input).toHaveValue(fullLink);

    // Copy.
    fireEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // flush the writeText promise
    });
    expect(writeText).toHaveBeenCalledWith(fullLink);
    expect(screen.getByRole('button', { name: /Link copied/ })).toBeVisible();

    // Reverts after the named setting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS);
    });
    expect(screen.getByRole('button', { name: /Copy link/ })).toBeVisible();
  });

  it('TC-23: Escape closes the panel', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
  });

  it('TC-24: click outside closes the panel and returns focus to the Share button', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // A pointerdown on the document (outside the panel) closes it.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveFocus();
  });

  it('TC-25: clicking inside the panel keeps it open', () => {
    render(<SharePanel boardId={BOARD_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    // The note is inside the panel: pointerdown on it must not close.
    fireEvent.pointerDown(screen.getByTestId('share-note'));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeVisible();

    // The security-model note is present.
    expect(screen.getByTestId('share-note')).toHaveTextContent(
      'Anyone with this link can view and edit this board.',
    );
  });
});
