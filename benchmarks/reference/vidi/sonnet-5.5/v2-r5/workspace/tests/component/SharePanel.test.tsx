import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const id = newBoardId();
const link = `${window.location.origin}/b/${id}`;
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

async function openPanel() {
  render(<div><SharePanel boardId={id} /><p>outside</p></div>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Share' })); });
  return screen.getByRole('dialog', { name: 'Share board' });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); setClipboard(undefined); });

describe('SharePanel (share.share_panel)', () => {
  it('boardLink builds origin/b/id', () => {
    expect(boardLink('https://x.test', 'abc')).toBe('https://x.test/b/abc');
  });

  it('shows the readonly link and the access note', async () => {
    const dialog = await openPanel();
    const input = dialog.querySelector('input[readonly]') as HTMLInputElement;
    expect(input.value).toBe(link);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
  });

  it('clicking the field selects the whole link', async () => {
    const dialog = await openPanel();
    const input = dialog.querySelector('input') as HTMLInputElement;
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
  });

  it('TC-22 copies the full link, "Link copied" for LINK_COPIED_MS then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await openPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(link).toMatch(/^https?:\/\/.+\/b\/[A-Za-z0-9_-]{22}$/);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1); });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-23 rejected clipboard → link selected and manual-copy message', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const dialog = await openPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });

  it('TC-24 missing clipboard API → same fallback', async () => {
    setClipboard(undefined);
    const dialog = await openPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
    expect(screen.getByText(MANUAL)).toBeTruthy();
  });

  it('a later successful copy replaces the manual-copy message', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    setClipboard({ writeText });
    await openPanel();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy link' })); });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-25 Escape closes and returns focus to Share', async () => {
    await openPanel();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25 outside pointerdown closes; inside does not', async () => {
    const dialog = await openPanel();
    await act(async () => { fireEvent.pointerDown(dialog.querySelector('input')!); });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { fireEvent.pointerDown(screen.getByText('outside')); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
