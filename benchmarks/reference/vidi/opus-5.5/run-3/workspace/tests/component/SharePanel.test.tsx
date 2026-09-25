// @vitest-environment-options {"url": "https://vidi6.example/"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const NOTE = 'Anyone with this link can view and edit this board.';

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

function openPanel(id = newBoardId()) {
  render(<SharePanel boardId={id} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = screen.getByRole('dialog', { name: 'Share board' });
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Board link' });
  return { id, dialog, input, copy: () => screen.getByRole('button', { name: /Copy link|Link copied/ }) };
}

function expectFullySelected(input: HTMLInputElement) {
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(input.value.length);
}

describe('share.share_panel', () => {
  it('boardLink is the full address of the board', () => {
    expect(boardLink('https://vidi6.example', 'AbCdEfGhIjKlMnOpQr_-09')).toBe('https://vidi6.example/b/AbCdEfGhIjKlMnOpQr_-09');
  });

  it('the panel shows the read-only link, Copy link and the access note', () => {
    const { id, input } = openPanel();
    expect(input).toHaveAttribute('readonly');
    expect(input.value).toBe(`https://vidi6.example/b/${id}`);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('clicking the link field selects the whole link', () => {
    const { input } = openPanel();
    input.setSelectionRange(3, 5);
    fireEvent.click(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('TC-22 Copy link writes the full link and shows Link copied for LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { id, copy } = openPanel();
    await act(async () => fireEvent.click(copy()));
    expect(writeText).toHaveBeenCalledWith(`https://vidi6.example/b/${id}`);
    expect(copy()).toHaveTextContent('Link copied');
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(copy()).toHaveTextContent('Link copied');
    act(() => vi.advanceTimersByTime(1));
    expect(copy()).toHaveTextContent('Copy link');
    expect(screen.queryByText(MANUAL)).not.toBeInTheDocument();
  });

  it('TC-23 writeText rejecting selects the whole link and shows the manual-copy message', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) });
    const { input, copy } = openPanel();
    fireEvent.click(input); // focus elsewhere first would not matter; the fallback refocuses
    input.setSelectionRange(0, 0);
    await act(async () => fireEvent.click(copy()));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expectFullySelected(input);
    expect(copy()).toHaveTextContent('Copy link');
  });

  it('TC-24 no clipboard API: same manual-copy fallback', async () => {
    setClipboard(undefined);
    expect(navigator.clipboard).toBeUndefined();
    const { input, copy } = openPanel();
    input.setSelectionRange(0, 0);
    await act(async () => fireEvent.click(copy()));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expectFullySelected(input);
  });

  it('manual copy, then a later successful copy shows Link copied', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    setClipboard({ writeText });
    const { copy } = openPanel();
    await act(async () => fireEvent.click(copy()));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    await act(async () => fireEvent.click(copy()));
    expect(copy()).toHaveTextContent('Link copied');
    expect(screen.queryByText(MANUAL)).not.toBeInTheDocument();
  });

  it('TC-25 Escape closes the panel and focus returns to Share', () => {
    openPanel();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(document.activeElement).toBe(share);
    expect(share).toHaveAttribute('aria-expanded', 'false');
  });

  it('TC-25 a press outside closes the panel (a press inside does not) without stealing focus', () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const { dialog, input } = openPanel();
    fireEvent.pointerDown(input);
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-expanded', 'false');
    // Focus is left to whatever was pressed (it is not pulled back to Share).
    outside.remove();
  });

  it('the Share button toggles the panel', () => {
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
