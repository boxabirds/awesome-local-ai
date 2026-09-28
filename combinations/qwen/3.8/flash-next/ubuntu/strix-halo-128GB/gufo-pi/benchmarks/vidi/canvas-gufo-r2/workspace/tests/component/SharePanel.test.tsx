/**
 * Component tests for Share panel (TC-22 to TC-25).
 * Stubbed clipboard, fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const TEST_BOARD_ID = 'abcdefghijklmnopqrstuv';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TC-22: writeText resolves → "Link copied" for LINK_COPIED_MS - 1, reverts at LINK_COPIED_MS
// ---------------------------------------------------------------------------
describe('TC-22: Copy link success', () => {
  it('writeText called with full https link; "Link copied" visible then reverts', async () => {
    vi.useFakeTimers();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    // Click Share to open panel
    const shareBtn = screen.getByRole('button', { name: 'Share' });
    await user.click(shareBtn);

    // Panel is open
    const panel = screen.getByRole('dialog', { name: 'Share board' });
    expect(panel).toBeInTheDocument();

    // Click Copy link
    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    await user.click(copyBtn);

    // Verify writeText was called with the correct link
    expect(writeText).toHaveBeenCalledWith(boardLink(window.location.origin, TEST_BOARD_ID));

    // "Link copied" should be visible
    await waitFor(() => {
      expect(screen.getByText(/Link copied/)).toBeInTheDocument();
    });

    // At LINK_COPIED_MS - 1, still showing
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByText(/Link copied/)).toBeInTheDocument();

    // At LINK_COPIED_MS, reverted back to "Copy link"
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// TC-23: writeText rejects → field fully selected, manual-copy message
// ---------------------------------------------------------------------------
describe('TC-23: Clipboard rejected', () => {
  it('writeText rejects → input selected, manual-copy message shown', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    await user.click(screen.getByRole('button', { name: 'Share' }));

    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    await user.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });

    // Verify input is selected (value property is accessible and selected text = full value)
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue(boardLink(window.location.origin, TEST_BOARD_ID));
    // In jsdom, input.select() sets selectionStart/selectionEnd
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(boardLink(window.location.origin, TEST_BOARD_ID).length);
  });
});

// ---------------------------------------------------------------------------
// TC-24: navigator.clipboard undefined → same as TC-23
// ---------------------------------------------------------------------------
describe('TC-24: Clipboard API missing', () => {
  it('clipboard undefined → manual-copy message shown', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    await user.click(screen.getByRole('button', { name: 'Share' }));

    const copyBtn = screen.getByRole('button', { name: 'Copy link' });
    await user.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// TC-25: Panel closes on Escape and outside click; focus returns to Share button
// ---------------------------------------------------------------------------
describe('TC-25: Panel close behavior', () => {
  it('Escape closes the panel', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_BOARD_ID} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    await user.click(shareBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shareBtn).toHaveFocus();
  });

  it('outside click closes the panel', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    const user = userEvent.setup();
    const { container } = render(
      <div>
        <div data-testid="outside">Outside content</div>
        <SharePanel boardId={TEST_BOARD_ID} />
      </div>,
    );

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    await user.click(shareBtn);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click outside
    await user.click(screen.getByTestId('outside'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shareBtn).toHaveFocus();
  });
});
