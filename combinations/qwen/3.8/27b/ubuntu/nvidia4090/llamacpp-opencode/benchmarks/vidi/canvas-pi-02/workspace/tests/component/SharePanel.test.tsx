/**
 * Story 5 component tests: share.share_panel (TC-22 to TC-25).
 *
 * Tests the Share panel's clipboard behaviour (success, rejection, missing
 * API) and close behaviour (Escape, outside click).
 *
 * Uses fireEvent to avoid pointerdown interference with the outside-click
 * handler. Uses real timers (LINK_COPIED_MS is short enough).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

// --- boardLink unit test ------------------------------------------------------

describe('boardLink', () => {
  it('returns origin + /b/ + id', () => {
    expect(boardLink('https://example.com', 'abc123')).toBe('https://example.com/b/abc123');
  });
});

// --- Clipboard helpers --------------------------------------------------------

function stubClipboardSuccess() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    writable: true,
    configurable: true,
  });
  return writeText;
}

function stubClipboardReject() {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    writable: true,
    configurable: true,
  });
  return writeText;
}

function stubClipboardMissing() {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- TC-22: copy success → "Link copied" for LINK_COPIED_MS --------------------

describe('TC-22 Copy link success', () => {
  it('writeText resolves → "Link copied" then reverts', async () => {
    const writeText = stubClipboardSuccess();
    const boardId = 'testboardid12345678901';

    render(<SharePanel boardId={boardId} />);

    // Open the panel
    fireEvent.click(screen.getByTestId('share-button'));

    // Click Copy link
    const copyBtn = screen.getByTestId('copy-link-button');
    fireEvent.click(copyBtn);

    // writeText was called with the full link
    const expectedLink = `${window.location.origin}/b/${boardId}`;
    expect(writeText).toHaveBeenCalledWith(expectedLink);

    // "Link copied" appears
    await waitFor(() => {
      expect(copyBtn.textContent).toContain('Link copied');
    });

    // After LINK_COPIED_MS, reverts to "Copy link"
    await waitFor(
      () => {
        expect(copyBtn.textContent).toBe('Copy link');
      },
      { timeout: LINK_COPIED_MS + 2000 },
    );
  }, 10_000);
});

// --- TC-23: copy rejected → manual copy ----------------------------------------

describe('TC-23 Copy rejected shows manual copy', () => {
  it('writeText rejects → manual-copy message shown', async () => {
    const writeText = stubClipboardReject();
    const boardId = 'testboardid12345678901';

    render(<SharePanel boardId={boardId} />);

    fireEvent.click(screen.getByTestId('share-button'));

    fireEvent.click(screen.getByTestId('copy-link-button'));

    // writeText was called
    expect(writeText).toHaveBeenCalled();

    // Manual copy message is shown
    await waitFor(() => {
      expect(screen.getByTestId('manual-copy-message')).toBeInTheDocument();
    });
  }, 10_000);
});

// --- TC-24: clipboard missing → manual copy ------------------------------------

describe('TC-24 Missing clipboard API shows manual copy', () => {
  it('navigator.clipboard undefined → manual-copy message', async () => {
    stubClipboardMissing();
    const boardId = 'testboardid12345678901';

    render(<SharePanel boardId={boardId} />);

    fireEvent.click(screen.getByTestId('share-button'));

    fireEvent.click(screen.getByTestId('copy-link-button'));

    // Manual copy message is shown
    await waitFor(() => {
      expect(screen.getByTestId('manual-copy-message')).toBeInTheDocument();
    });
  }, 10_000);
});

// --- TC-25: close behaviour -----------------------------------------------------

describe('TC-25 Panel close behaviour', () => {
  it('Escape closes the panel and returns focus to Share button', async () => {
    stubClipboardSuccess();
    const boardId = 'testboardid12345678901';

    render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByTestId('share-button');
    fireEvent.click(shareBtn);

    // Panel is open
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // Panel is closed
    await waitFor(() => {
      expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    });

    // Focus is on the Share button
    expect(shareBtn).toHaveFocus();
  }, 10_000);

  it('outside click closes the panel', async () => {
    stubClipboardSuccess();
    const boardId = 'testboardid12345678901';

    // Render with an outside element
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <SharePanel boardId={boardId} />
      </div>,
    );

    fireEvent.click(screen.getByTestId('share-button'));

    // Panel is open
    expect(screen.getByTestId('share-panel')).toBeInTheDocument();

    // Click outside (pointerdown on outside element)
    const outside = screen.getByTestId('outside');
    fireEvent.pointerDown(outside);

    // Panel is closed
    await waitFor(() => {
      expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
    });
  }, 10_000);
});
