/**
 * @vitest-environment-options {"url": "https://vidi6.example/"}
 */
// share.share_panel: copy with a stubbed clipboard (allowed, rejected, missing) and closing.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';

const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';
const id = newBoardId();
const LINK = `https://vidi6.example/b/${id}`;

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function openPanel() {
  render(
    <>
      <div data-testid="outside">board</div>
      <SharePanel boardId={id} />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  return screen.getByRole('dialog', { name: 'Share board' });
}

const linkField = () => screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('share.share_panel', () => {
  it('boardLink is the full address of the board', () => {
    expect(boardLink('https://vidi6.example', id)).toBe(LINK);
  });

  it('the panel shows the link read-only, Copy link and the access note; clicking the field selects it all', () => {
    openPanel();
    const field = linkField();
    expect(field.value).toBe(LINK);
    expect(field.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeTruthy();
    field.setSelectionRange(0, 0);
    fireEvent.click(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
  });

  it('TC-22 Copy link writes the full link and shows Link copied for LINK_COPIED_MS', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();

    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(LINK.startsWith('https://')).toBe(true);
    expect(screen.getByRole('button', { name: 'Link copied' }).textContent).toContain('✓');
    expect(screen.queryByText(MANUAL)).toBeNull();

    act(() => vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('TC-23 a rejected write selects the whole link and shows the manual-copy message', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) });
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();

    const field = linkField();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });

  it('TC-24 without a clipboard API: same as a rejected write', async () => {
    setClipboard(undefined);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();

    const field = linkField();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
  });

  it('manual copy turns into Link copied when a later write succeeds', async () => {
    const writeText = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    setClipboard({ writeText });
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByText(MANUAL)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-25 Escape closes the panel and focus returns to Share', () => {
    openPanel();
    linkField().focus();
    fireEvent.keyDown(linkField(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25 a click outside closes the panel and focus returns to Share; a click inside does not', () => {
    openPanel();
    fireEvent.pointerDown(linkField());
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('Share toggles the panel', () => {
    openPanel();
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(share);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(share.getAttribute('aria-expanded')).toBe('false');
  });
});
