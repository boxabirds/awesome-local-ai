// Component tests for the Share panel (design "share.share_panel": TC-22 to TC-25).
//
// The panel is tested where it lives — in the board page's header, reached by the
// same click a visitor uses — with the board page already past its link check.
// Timers are faked, because TC-22 asserts the exact instant the "Link copied"
// confirmation gives way to the plain button again (design Boundary values:
// LINK_COPIED_MS - 1 and LINK_COPIED_MS).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { App, atPath, mockBoardApi, settle } from './helpers/appShell.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LINK_COPIED_MS } from '../../src/shared/config.ts';

/** A socket that stays open-looking and never talks to a server. */
class DeadWebSocket {
  readyState = 0;
  binaryType = 'arraybuffer';
  constructor(public readonly url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

let boardId: string;

/** The link the panel should be offering: this very page, absolute. */
function expectedLink(): string {
  return `${window.location.origin}/b/${boardId}`;
}

/**
 * Put the app on a board page with the link check already answered, and return the
 * Share button.
 */
async function openBoardPage() {
  mockBoardApi(() => ({ status: 200 }));
  atPath(`/b/${boardId}`);
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('share-button')).toBeInTheDocument());
  return screen.getByTestId('share-button');
}

function stubClipboard(clipboard: { writeText?: (text: string) => Promise<void> } | undefined) {
  if (clipboard === undefined) {
    // The browser offers no clipboard at all: old Safari, http origins, a visitor
    // who denied the permission.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    return;
  }
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: clipboard,
  });
}

beforeEach(() => {
  boardId = newBoardId();
  vi.stubGlobal('WebSocket', DeadWebSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as { clipboard?: unknown }).clipboard;
  atPath('/');
});

describe('share panel (TC-22 to TC-25)', () => {
  it('TC-22 copies the full link and reverts the confirmation after exactly LINK_COPIED_MS', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    stubClipboard({ writeText });
    const share = await openBoardPage();
    // Only the confirmation's lifetime is faked — mounting needs real timers for
    // `waitFor`.
    vi.useFakeTimers();

    fireEvent.click(share);
    const panel = screen.getByRole('dialog', { name: 'Share board' });
    expect(panel).toBeInTheDocument();
    // The panel states the security model where the link is handed out.
    expect(screen.getByTestId('share-note')).toHaveTextContent(
      'Anyone with this link can view and edit this board.',
    );
    expect(screen.getByTestId('share-link')).toHaveValue(expectedLink());

    fireEvent.click(screen.getByTestId('share-copy'));
    // The write settles without any timer running; the confirmation is what the
    // timers below measure.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(writeText).toHaveBeenCalledWith(expectedLink());
    expect(screen.queryByTestId('share-manual')).toBeNull();

    const copied = screen.getByTestId('share-copy');
    expect(copied).toHaveTextContent('Link copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Link copied');

    // The boundary: one millisecond later the button is itself again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
    expect(screen.getByTestId('share-copy')).not.toHaveTextContent('Link copied');
  });

  it('TC-23 hands the link over by hand when the browser refuses the write', async () => {
    const writeText = vi.fn(async (_text: string) => {
      throw new Error('Document is not focused');
    });
    stubClipboard({ writeText });
    const share = await openBoardPage();

    fireEvent.click(share);
    fireEvent.click(screen.getByTestId('share-copy'));
    await act(async () => {
      await settle(6);
    });

    expect(screen.getByTestId('share-manual')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    // The whole link is selected, so the keystroke is all that is missing.
    const field = screen.getByTestId('share-link') as HTMLInputElement;
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(expectedLink().length);
    // And no false confirmation.
    expect(screen.getByTestId('share-copy')).toHaveTextContent('Copy link');
  });

  it('TC-24 falls back the same way when the browser has no clipboard API', async () => {
    stubClipboard(undefined);
    const share = await openBoardPage();

    fireEvent.click(share);
    fireEvent.click(screen.getByTestId('share-copy'));
    await act(async () => {
      await settle(6);
    });

    expect(screen.getByTestId('share-manual')).toHaveTextContent(
      'Press Ctrl+C (Cmd+C on Mac) to copy',
    );
    const field = screen.getByTestId('share-link') as HTMLInputElement;
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(expectedLink().length);
  });

  it('TC-25 closes on Escape and on a press outside, returning focus to the Share button', async () => {
    stubClipboard({ writeText: async () => {} });
    const share = await openBoardPage();

    // Escape closes.
    fireEvent.click(share);
    expect(screen.getByTestId('share-link')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(screen.getByTestId('share-button')).toHaveFocus();

    // A press outside the panel closes.
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('share-link')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('share-link')).toBeNull();
    expect(screen.getByTestId('share-button')).toHaveFocus();

    // A press inside the panel does not.
    fireEvent.click(screen.getByTestId('share-button'));
    fireEvent.pointerDown(screen.getByTestId('share-note'));
    expect(screen.getByTestId('share-link')).toBeInTheDocument();
  });

  it('keeps a query string out of the link so a debug parameter is never shared', async () => {
    stubClipboard({ writeText: async () => {} });
    atPath(`/b/${boardId}?hideHint=1`);
    mockBoardApi(() => ({ status: 200 }));
    render(<App />);

    fireEvent.click(await screen.findByTestId('share-button'));
    expect(screen.getByTestId('share-link')).toHaveValue(`http://localhost:3000/b/${boardId}`);
  });
});
