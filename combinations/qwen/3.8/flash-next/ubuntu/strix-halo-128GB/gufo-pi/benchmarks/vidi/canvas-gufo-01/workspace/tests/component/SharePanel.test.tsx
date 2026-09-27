// Share panel: copy behaviour (clipboard, fallback) and dismissal.
// TC-22 .. TC-25 from spec/stories/005-share-a-board-with-others-using-a-link/design.md

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const ID = 'Ab3dEf6hIjKlMnOpQrStUv';
const LINK = `${window.location.origin}/b/${ID}`;

/** Let the click handler's promise chain settle (fake timers do not fake jobs). */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

function openPanel(): ReturnType<typeof render> {
  const view = render(<SharePanel boardId={ID} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  return view;
}

function setClipboard(clipboard: Partial<Clipboard> | undefined): void {
  if (clipboard === undefined) {
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    return;
  }
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

describe('boardLink', () => {
  it('is the board path on the current origin', () => {
    expect(boardLink('https://vidi6.example', ID)).toBe(`https://vidi6.example/b/${ID}`);
  });
});

describe('opening the panel', () => {
  it('shows the exact sharing copy and the link', () => {
    render(<SharePanel boardId={ID} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeInTheDocument();
    expect(screen.getByLabelText('Board link')).toHaveValue(LINK);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('copy link', () => {
  it('TC-22 writes the link to the clipboard, confirms, then reverts', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async (_text: string) => undefined);
    setClipboard({ writeText });
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    expect(screen.queryByText('Press Ctrl+C (Cmd+C on Mac) to copy')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-23 falls back to manual copy when the clipboard rejects', async () => {
    const writeText = vi.fn(async (_text: string) => {
      throw new DOMException('Document is not focused.', 'NotAllowedError');
    });
    setClipboard({ writeText });
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy');
    const input = screen.getByLabelText<HTMLInputElement>('Board link');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-24 falls back to manual copy when the clipboard API is missing', async () => {
    setClipboard(undefined);
    openPanel();
    expect((navigator as unknown as { clipboard?: Clipboard }).clipboard).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(screen.getByLabelText('Board link')).toHaveFocus();
  });
});

describe('dismissing the panel', () => {
  it('TC-25 closes on Escape and returns focus to Share', () => {
    openPanel();
    const share = screen.getByRole('button', { name: 'Share' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(share).toHaveFocus();
    expect(share).toHaveAttribute('aria-expanded', 'false');
  });

  it('TC-25b closes on a click outside the panel', () => {
    render(
      <div>
        <SharePanel boardId={ID} />
        <button type="button">somewhere else</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'somewhere else' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // clicks inside the panel keep it open
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Copy link' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closing via the close button works too', () => {
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
