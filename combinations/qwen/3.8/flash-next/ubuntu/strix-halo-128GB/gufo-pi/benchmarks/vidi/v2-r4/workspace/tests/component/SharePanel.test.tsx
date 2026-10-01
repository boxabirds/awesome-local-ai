/**
 * Component tests for SharePanel (story 5).
 * TC-22, TC-23, TC-24, TC-25.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'abcdefghijklmnopqrstuv';

describe('share.share_panel', () => {
  beforeEach(() => {
    // Set up a default clipboard mock
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TC-22: writeText resolves → "Link copied" shown, then reverts after LINK_COPIED_MS
  it('TC-22: copy link shows confirmation then reverts', async () => {
    render(<SharePanel boardId={BOARD_ID} />);

    // Click Share to open panel
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    // Panel is visible
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(boardLink(window.location.origin, BOARD_ID));

    // Click Copy link
    const copyButton = screen.getByRole('button', { name: 'Copy link' });
    await userEvent.click(copyButton);

    // writeText called with full link
    const expectedLink = boardLink(window.location.origin, BOARD_ID);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedLink);

    // "Link copied" shown
    await waitFor(() => {
      expect(screen.getByText(/Link copied/)).toBeInTheDocument();
    });

    // After LINK_COPIED_MS + small buffer, reverted to "Copy link"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
      expect(screen.queryByText(/Link copied/)).not.toBeInTheDocument();
    }, { timeout: LINK_COPIED_MS + 500 });
  });

  // TC-23: writeText rejects → select input, manual-copy message
  it('TC-23: clipboard rejected shows manual copy message', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));

    render(<SharePanel boardId={BOARD_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    const copyButton = screen.getByRole('button', { name: 'Copy link' });
    await userEvent.click(copyButton);

    // Manual copy message shown
    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });

    // Input is selected (selectionStart = 0 and selectionEnd = value.length)
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(boardLink(window.location.origin, BOARD_ID).length);
  });

  // TC-24: navigator.clipboard undefined → same as TC-23
  it('TC-24: clipboard missing shows manual copy message', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<SharePanel boardId={BOARD_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));

    const copyButton = screen.getByRole('button', { name: 'Copy link' });
    await userEvent.click(copyButton);

    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });
  });

  // TC-25a: Escape closes panel
  it('TC-25a: Escape closes panel', async () => {
    render(<SharePanel boardId={BOARD_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });

  // TC-25b: outside pointerdown closes panel
  it('TC-25b: outside pointerdown closes panel', async () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <SharePanel boardId={BOARD_ID} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    // Click outside the panel
    await userEvent.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });

  // Test boardLink helper
  it('boardLink constructs correct URL', () => {
    expect(boardLink('https://example.com', 'abc123')).toBe('https://example.com/b/abc123');
  });

  // Note text is shown
  it('shows the "Anyone with this link" note', async () => {
    render(<SharePanel boardId={BOARD_ID} />);
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText('Anyone with this link can view and edit this board.')).toBeInTheDocument();
  });
});
