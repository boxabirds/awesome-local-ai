import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const id = newBoardId();
const link = boardLink(window.location.origin, id);

function stubClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

async function openPanel() {
  render(<SharePanel boardId={id} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  return screen.getByRole('dialog', { name: 'Share board' });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SharePanel', () => {
  it('boardLink builds the full address', () => {
    expect(boardLink('https://vidi6.example', 'abc')).toBe('https://vidi6.example/b/abc');
  });

  it('shows a read-only link field, Copy link and the access note; clicking the field selects the link', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const dialog = await openPanel();
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect(dialog.contains(field)).toBe(true);
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe(link);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
    fireEvent.click(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, link.length]);
  });

  it('TC-22: copies the full link; "Link copied" shows for LINK_COPIED_MS then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    await openPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => void vi.advanceTimersByTime(1));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('TC-23: a rejected clipboard write selects the link and shows the manual-copy message', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await openPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, link.length]);
    expect(document.activeElement).toBe(field);
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('TC-24: a missing clipboard API behaves the same', async () => {
    stubClipboard(undefined);
    await openPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    const field = screen.getByRole('textbox') as HTMLInputElement;
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, link.length]);
    expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeTruthy();
  });

  it('TC-25: Escape and outside click close the panel and return focus to Share', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    await openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a pointer press inside the panel keeps it open', async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const dialog = await openPanel();
    fireEvent.pointerDown(dialog);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
