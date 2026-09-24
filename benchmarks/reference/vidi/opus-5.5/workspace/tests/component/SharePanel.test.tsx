/**
 * share.share_panel (story 5): copy with the clipboard allowed, rejected and missing; the
 * "Link copied" confirmation's exact duration; closing with Escape and outside clicks.
 * Clipboard is stubbed on navigator (no user-event: it installs its own clipboard).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const NOTE = 'Anyone with this link can view and edit this board.';

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderPanel(id = newBoardId()) {
  render(
    <>
      <div data-testid="outside">board</div>
      <SharePanel boardId={id} />
    </>,
  );
  return id;
}

function openPanel(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  return screen.getByRole('dialog', { name: 'Share board' });
}

function linkField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
}

function expectFullySelected(input: HTMLInputElement): void {
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  setClipboard(undefined);
});

describe('share.share_panel', () => {
  it('boardLink is the full address', () => {
    const id = newBoardId();
    expect(boardLink('https://vidi6.example', id)).toBe(`https://vidi6.example/b/${id}`);
  });

  it('panel shows the read-only full link, Copy link and the access note', () => {
    const id = renderPanel();
    expect(screen.queryByRole('dialog')).toBeNull();
    openPanel();
    const input = linkField();
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(`${window.location.origin}/b/${id}`);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking inside the link field selects the whole link and keeps the panel open', () => {
    renderPanel();
    openPanel();
    const input = linkField();
    fireEvent.pointerDown(input);
    fireEvent.click(input);
    expectFullySelected(input);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
  });

  it('TC-22 allowed: writeText gets the full link; "Link copied" for exactly LINK_COPIED_MS', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const id = renderPanel();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/b/${id}`);
    expect(writeText.mock.calls[0]).toEqual([linkField().value]);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.getByText('✓', { exact: false })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
  });

  it('TC-23 rejected: the link is fully selected and the manual-copy message shows', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) });
    renderPanel();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expectFullySelected(linkField());
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });

  it('TC-23 manual copy then a later successful copy → Link copied', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    setClipboard({ writeText });
    renderPanel();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-24 clipboard API missing: same as rejected', async () => {
    setClipboard(undefined);
    renderPanel();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expectFullySelected(linkField());
  });

  it('TC-25 Escape closes; focus returns to Share', () => {
    renderPanel();
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(document.activeElement).toBe(share);
    expect(share.getAttribute('aria-expanded')).toBe('false');
  });

  it('TC-25 outside click closes; focus returns to Share', () => {
    renderPanel();
    openPanel();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25 closing while "Link copied" shows: reopening starts from Copy link, timer cleared', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) });
    renderPanel();
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(vi.getTimerCount()).toBe(0);
    openPanel();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('Share toggles the panel', () => {
    renderPanel();
    openPanel();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
