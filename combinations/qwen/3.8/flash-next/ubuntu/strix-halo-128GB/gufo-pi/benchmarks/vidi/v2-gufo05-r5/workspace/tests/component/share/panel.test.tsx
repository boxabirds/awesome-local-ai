/**
 * Share panel component tests (TC-21, TC-22, TC-23, TC-24, TC-33).
 *
 * Tests: dialog opens, link field contains correct URL, copy with working clipboard,
 * clipboard failure → manual copy message, Escape and outside click close,
 * all controls have accessible names.
 *
 * Note: @testing-library/user-event replaces navigator.clipboard.writeText with its own
 * implementation. For clipboard-related tests (TC-22, TC-23) we use fireEvent.click to
 * bypass user-event's clipboard interception and test our component's logic directly.
 */
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharePanel, boardLink } from '../../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../../src/shared/config';

const TEST_ID = 'abcdefghijklmnopqrstuv';

describe('SharePanel (TC-21, TC-22, TC-23, TC-24, TC-33)', () => {
  test('TC-21: Share button opens dialog with link field and copy button', async () => {
    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_ID} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    await user.click(shareBtn);

    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Board link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  test('TC-25: link field contains full board link', async () => {
    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_ID} />);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox', { name: 'Board link' });
    const expected = `${window.location.origin}/b/${TEST_ID}`;
    expect(input).toHaveValue(expected);
  });

  test('TC-22: copy with working clipboard shows "Link copied", resets after LINK_COPIED_MS', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<SharePanel boardId={TEST_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/b/${TEST_ID}`,
      );
    });
    expect(screen.getByText('✓ Link copied')).toBeInTheDocument();

    // Reset after LINK_COPIED_MS
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, LINK_COPIED_MS + 50));
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  test('TC-23: clipboard failure shows manual copy message', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<SharePanel boardId={TEST_ID} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => {
      expect(screen.getByText(/Press Ctrl\+C/i)).toBeInTheDocument();
    });
  });

  test('TC-24: Escape closes the dialog and returns focus to Share button', async () => {
    const user = userEvent.setup();
    render(<SharePanel boardId={TEST_ID} />);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    await user.click(shareBtn);
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(shareBtn).toHaveFocus();
  });

  test('TC-24: outside click closes the dialog', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <SharePanel boardId={TEST_ID} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('TC-33: Share button has accessible name', () => {
    render(<SharePanel boardId={TEST_ID} />);
    const btn = screen.getByRole('button', { name: 'Share' });
    expect(btn).toBeInTheDocument();
  });
});

describe('boardLink helper', () => {
  test('builds correct URL from origin and id', () => {
    expect(boardLink('http://localhost:5173', 'abcdefghijklmnopqrstuv')).toBe(
      'http://localhost:5173/b/abcdefghijklmnopqrstuv',
    );
  });
});
