/**
 * Component tests for the Share panel (share.share_panel) with a stubbed
 * clipboard and fake timers:
 *  TC-22 copy success: writeText gets the full link; "Link copied" at
 *          LINK_COPIED_MS − 1, reverted at LINK_COPIED_MS (boundary)
 *  TC-23 writeText rejects → input fully selected + manual-copy message
 *  TC-24 navigator.clipboard undefined → same manual-copy fallback
 *  TC-25 Escape and outside pointerdown close; focus returns to Share button
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel } from '../../src/client/share/SharePanel';

const VALID_ID = 'b'.repeat(22);
const ORIGIN = 'http://localhost:3000';
const LINK = `${ORIGIN}/b/${VALID_ID}`;
const MANUAL_COPY_MESSAGE = 'Press Ctrl+C (Cmd+C on Mac) to copy';

function setClipboard(value: unknown): void {
  Object.defineProperty(window.navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function openPanel(): HTMLButtonElement {
  const shareButton = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
  fireEvent.click(shareButton);
  expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
  return shareButton;
}

function assertManualCopyFallback(): void {
  const input = screen.getByLabelText('Board link') as HTMLInputElement;
  // The whole link is selected and focused for a manual Ctrl/Cmd+C.
  expect(input.value).toBe(LINK);
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(LINK.length);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toBe(MANUAL_COPY_MESSAGE);
}

describe('share.share_panel', () => {
  it('TC-22: copy resolves → full link written; "Link copied" until LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<SharePanel boardId={VALID_ID} />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    // The async write resolves on a microtask.
    await act(async () => {});
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(LINK);

    // Copied state, held for LINK_COPIED_MS (boundary on both edges).
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-23: writeText rejects → input selected, manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    setClipboard({ writeText });

    render(<SharePanel boardId={VALID_ID} />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith(LINK);
    assertManualCopyFallback();
  });

  it('TC-24: navigator.clipboard undefined → same manual-copy fallback', async () => {
    setClipboard(undefined);

    render(<SharePanel boardId={VALID_ID} />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await act(async () => {});
    assertManualCopyFallback();
  });

  it('TC-25: Escape and outside pointerdown close; focus returns to Share', () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });

    render(<SharePanel boardId={VALID_ID} />);
    const shareButton = openPanel();

    // Escape closes and returns focus.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(shareButton);

    // Outside pointerdown closes and returns focus.
    openPanel();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Share board' })).toBeNull();
    expect(document.activeElement).toBe(shareButton);
  });
});
