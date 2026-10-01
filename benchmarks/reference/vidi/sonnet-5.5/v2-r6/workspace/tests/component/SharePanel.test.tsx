import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const LINK = `${window.location.origin}/b/${ID}`;
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

function stubClipboard(writeText: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value: writeText === undefined ? undefined : { writeText }, configurable: true });
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Share' }));
const copy = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copy link|Link copied/ })); }); };
const field = () => screen.getByRole('textbox') as HTMLInputElement;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); stubClipboard(undefined); });

describe('SharePanel', () => {
  it('boardLink joins origin and id', () => {
    expect(boardLink('https://x.test', ID)).toBe(`https://x.test/b/${ID}`);
  });

  it('opens a dialog with the read-only link, Copy link and the access note', () => {
    render(<SharePanel boardId={ID} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
    expect(field().readOnly).toBe(true);
    expect(field().value).toBe(LINK);
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
  });

  it('TC-22: copies the full link; "Link copied" for exactly LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<SharePanel boardId={ID} />);
    open();
    await copy();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1); });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  for (const [name, clipboard] of [
    ['TC-23: writeText rejects', vi.fn().mockRejectedValue(new Error('denied'))],
    ['TC-24: clipboard API missing', undefined],
  ] as const) {
    it(`${name} → link selected and manual-copy message`, async () => {
      stubClipboard(clipboard);
      render(<SharePanel boardId={ID} />);
      open();
      await copy();
      expect(screen.getByText(MANUAL)).toBeTruthy();
      expect(field().selectionStart).toBe(0);
      expect(field().selectionEnd).toBe(LINK.length);
      expect(document.activeElement).toBe(field());
    });
  }

  it('clicking the field selects the whole link', () => {
    render(<SharePanel boardId={ID} />);
    open();
    field().setSelectionRange(2, 3);
    fireEvent.click(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(LINK.length);
  });

  it('TC-25: Escape closes and focus returns to Share', () => {
    render(<SharePanel boardId={ID} />);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25: an outside click closes; a click inside does not', () => {
    render(<div><span data-testid="outside">x</span><SharePanel boardId={ID} /></div>);
    open();
    fireEvent.pointerDown(field());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
