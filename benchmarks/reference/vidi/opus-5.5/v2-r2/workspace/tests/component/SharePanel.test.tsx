// Story 5 — Share panel (share.share_panel): TC-22 to TC-25 with a stubbed clipboard.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const NOTE = 'Anyone with this link can view and edit this board.';

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  stubClipboard(undefined);
});

function openPanel(boardId = newBoardId()) {
  render(
    <div>
      <p>Board</p>
      <SharePanel boardId={boardId} />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = screen.getByRole('dialog', { name: 'Share board' });
  const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
  return { boardId, dialog, input };
}

function selectionOf(input: HTMLInputElement) {
  return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
}

describe('SharePanel', () => {
  it('boardLink is the full address', () => {
    expect(boardLink('https://vidi6.example', 'abc')).toBe('https://vidi6.example/b/abc');
  });

  it('shows the read-only link, Copy link and the access note; clicking the field selects the link', () => {
    const { boardId, input } = openPanel();
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(`${window.location.origin}/b/${boardId}`);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    input.setSelectionRange(0, 0);
    fireEvent.click(input);
    expect(selectionOf(input)).toBe(input.value);
  });

  it('TC-22: Copy link writes the full link; "Link copied" for LINK_COPIED_MS, then reverts', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard({ writeText });
    const origin = 'https://vidi6.example';
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, origin } as Location);
    const { boardId } = openPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(writeText).toHaveBeenCalledWith(`https://vidi6.example/b/${boardId}`);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
    act(() => vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
  });

  it('TC-23: writeText rejects → the whole link is selected and the manual-copy message shows', async () => {
    stubClipboard({ writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) });
    const { input } = openPanel();
    input.setSelectionRange(0, 0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(selectionOf(input)).toBe(input.value);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-24: navigator.clipboard missing → same as TC-23', async () => {
    stubClipboard(undefined);
    const { input } = openPanel();
    input.setSelectionRange(0, 0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(selectionOf(input)).toBe(input.value);
  });

  it('manual copy, then a later successful copy → "Link copied"', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    stubClipboard({ writeText });
    openPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-25: Escape closes the panel and focus returns to Share', () => {
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25: a press outside closes the panel and focus returns to Share; a press inside does not', () => {
    const { input } = openPanel();
    fireEvent.pointerDown(input);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('Board'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });
});
