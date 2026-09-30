// @vitest-environment-options {"url":"https://vidi6.example/b/AbCdEfGhIjKlMnOpQr_-09"}
// Share panel (share.share_panel): TC-22 to TC-25 with a stubbed clipboard.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const ID = 'AbCdEfGhIjKlMnOpQr_-09';
const LINK = `https://vidi6.example/b/${ID}`;
const MANUAL = 'Press Ctrl+C (Cmd+C on Mac) to copy';

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function renderPanel() {
  render(
    <div>
      <SharePanel boardId={ID} />
      <div data-testid="outside">board</div>
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = screen.getByRole('dialog', { name: 'Share board' });
  const input = screen.getByRole('textbox', { name: 'Board link' }) as HTMLInputElement;
  return { dialog, input };
}

function fullySelected(input: HTMLInputElement): boolean {
  return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('boardLink', () => {
  it('is origin + /b/ + id', () => {
    expect(boardLink('https://vidi6.example', ID)).toBe(LINK);
  });
});

describe('SharePanel', () => {
  it('opens a panel with the read-only full link, Copy link and the access note', () => {
    const { dialog, input } = renderPanel();
    expect(dialog).toBeInTheDocument();
    expect(input).toHaveAttribute('readonly');
    expect(input.value).toBe(LINK);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeInTheDocument();
  });

  it('clicking the link field selects the whole link', () => {
    const { input } = renderPanel();
    input.setSelectionRange(3, 5);
    fireEvent.click(input);
    expect(fullySelected(input)).toBe(true);
  });

  it('TC-22: writeText gets the full https link; "Link copied" for LINK_COPIED_MS, then reverts', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: 'Link copied' })).toHaveTextContent('✓');
    act(() => vi.advanceTimersByTime(LINK_COPIED_MS - 1));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-23: writeText rejects → whole link selected and the manual-copy message', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError'))) });
    const { input } = renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expect(fullySelected(input)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull();
  });

  it('TC-24: navigator.clipboard undefined → same as a rejection', async () => {
    setClipboard(undefined);
    expect(navigator.clipboard).toBeUndefined();
    const { input } = renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    expect(fullySelected(input)).toBe(true);
  });

  it('ManualCopy → Copied when a later writeText resolves', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByText(MANUAL)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    expect(screen.queryByText(MANUAL)).toBeNull();
  });

  it('TC-25: Escape closes the panel and focus returns to Share', () => {
    renderPanel();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25: a pointerdown outside closes the panel and focus returns to Share; inside does not', () => {
    const { input } = renderPanel();
    fireEvent.pointerDown(input);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Share' }));
  });

  it('TC-25: closing while "Link copied" shows resets the panel for next time', async () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) });
    renderPanel();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(LINK_COPIED_MS));
  });
});
