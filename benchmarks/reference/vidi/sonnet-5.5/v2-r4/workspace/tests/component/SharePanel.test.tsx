import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const id = newBoardId();
const link = boardLink(window.location.origin, id);
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

function stubClipboard(writeText: ((s: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Share' }));
const flush = (ms = 0) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SharePanel', () => {
  it('boardLink joins origin and id', () => {
    expect(boardLink('https://x.test', 'abc')).toBe('https://x.test/b/abc');
  });

  it('opens a dialog with the read-only link, Copy link and the access note', () => {
    render(<SharePanel boardId={id} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    const dialog = screen.getByRole('dialog', { name: 'Share board' });
    const input = dialog.querySelector('input') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(link);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
  });

  it('clicking the field selects the whole link', () => {
    render(<SharePanel boardId={id} />);
    open();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
  });

  it('TC-22: copies the full link; "Link copied" for LINK_COPIED_MS then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<SharePanel boardId={id} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await flush(LINK_COPIED_MS - 1);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await flush(1);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-23: writeText rejecting selects the link and shows the manual-copy message', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<SharePanel boardId={id} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });

  it('TC-24: a missing clipboard API behaves the same', async () => {
    stubClipboard(undefined);
    render(<SharePanel boardId={id} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, link.length]);
    expect(screen.getByText(MANUAL)).toBeTruthy();
  });

  it('a later successful copy replaces the manual-copy message', async () => {
    stubClipboard(vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined));
    render(<SharePanel boardId={id} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-25: Escape closes and focus returns to Share', () => {
    render(<SharePanel boardId={id} />);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25: an outside click closes, an inside click does not', () => {
    render(
      <div>
        <p>elsewhere</p>
        <SharePanel boardId={id} />
      </div>,
    );
    open();
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });
});
