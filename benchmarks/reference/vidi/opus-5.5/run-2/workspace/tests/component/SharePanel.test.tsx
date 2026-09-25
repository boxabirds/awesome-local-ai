// @vitest-environment-options { "url": "https://vidi6.example/" }
/**
 * Share panel (share.share_panel, TC-22 to TC-25): the clipboard is stubbed so that the
 * allowed, rejected and missing paths are all forced deterministically.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const NOTE = 'Anyone with this link can view and edit this board.';

function setClipboard(value: { writeText(text: string): Promise<void> } | undefined): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function openPanel(boardId = newBoardId()) {
  render(
    <>
      <div data-testid="elsewhere">board</div>
      <SharePanel boardId={boardId} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = screen.getByRole('dialog', { name: 'Share board' });
  const field = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
  return { boardId, dialog, field, link: `${window.location.origin}/b/${boardId}` };
}

function copyButton(): HTMLElement {
  return screen.getByRole('button', { name: /Copy link|Link copied/ });
}

function expectFullySelected(field: HTMLInputElement): void {
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard; // remove the per-test stub
});

describe('SharePanel (share.copy, share.copy_fallback)', () => {
  it('boardLink is origin + /b/ + id', () => {
    expect(boardLink('https://vidi6.example', 'abc')).toBe('https://vidi6.example/b/abc');
  });

  it('opens a panel with the read-only full link, Copy link and the access note', () => {
    const { field, link } = openPanel();
    expect(field).toHaveAttribute('readonly');
    expect(field.value).toBe(link);
    expect(link).toMatch(/^https:\/\/vidi6\.example\/b\/[A-Za-z0-9_-]{22}$/);
    expect(copyButton()).toHaveTextContent('Copy link');
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicking the link field selects the whole link', () => {
    const { field } = openPanel();
    field.setSelectionRange(3, 5);
    fireEvent.click(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('TC-22 Copy link writes the full https link and shows "Link copied" for LINK_COPIED_MS', async () => {
    const writeText = vi.fn(async () => {});
    setClipboard({ writeText });
    const { link } = openPanel();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(link.startsWith('https://')).toBe(true);
    expect(copyButton()).toHaveTextContent('Link copied');
    expect(copyButton()).toHaveTextContent('✓');
    expect(screen.queryByText(MANUAL)).toBeNull();

    act(() => vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(copyButton()).toHaveTextContent('Link copied');
    act(() => vi.advanceTimersByTime(1));
    expect(copyButton()).toHaveTextContent('Copy link');
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
  });

  it('TC-23 writeText rejects: the link is selected and the manual-copy message shows', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new DOMException('denied', 'NotAllowedError'))) });
    const { field } = openPanel();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expectFullySelected(field);
    expect(copyButton()).toHaveTextContent('Copy link');
  });

  it('TC-24 navigator.clipboard undefined: same as rejected', async () => {
    setClipboard(undefined);
    expect(navigator.clipboard).toBeUndefined();
    const { field } = openPanel();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expectFullySelected(field);
  });

  it('a later successful copy replaces the manual-copy message with "Link copied"', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValueOnce(new Error('denied')).mockResolvedValue();
    setClipboard({ writeText });
    openPanel();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    expect(screen.queryByText(MANUAL)).toBeNull();
    expect(copyButton()).toHaveTextContent('Link copied');
  });
});

describe('SharePanel closing (TC-25)', () => {
  it('Escape closes the panel and returns focus to Share', () => {
    const { field } = openPanel();
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).toHaveFocus();
    expect(share).toHaveAttribute('aria-expanded', 'false');
  });

  it('a click outside closes the panel; a click inside does not', () => {
    const { field } = openPanel();
    fireEvent.pointerDown(field);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing resets the copied state', async () => {
    setClipboard({ writeText: vi.fn(async () => {}) });
    openPanel();
    await act(async () => {
      fireEvent.click(copyButton());
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(copyButton()).toHaveTextContent('Copy link');
  });
});
