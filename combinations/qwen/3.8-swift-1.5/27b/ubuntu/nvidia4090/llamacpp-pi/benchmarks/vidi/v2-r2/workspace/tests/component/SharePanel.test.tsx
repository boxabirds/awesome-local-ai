import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newBoardId } from '../../src/shared/board-id';
import { LINK_COPIED_MS } from '../../src/shared/config';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';

const boardId = newBoardId();
const link = boardLink(window.location.origin, boardId);

/**
 * Stubs navigator.clipboard: 'resolve' | 'reject' | 'missing'.
 * Must be called AFTER userEvent.setup(): userEvent installs its own
 * clipboard implementation during setup, which would shadow this stub.
 */
function stubClipboard(impl: 'resolve' | 'reject' | 'missing') {
  if (impl === 'missing') {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    return;
  }
  const writeText = vi.fn(() =>
    impl === 'resolve' ? Promise.resolve() : Promise.reject(new Error('not permitted'))
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

const shareButton = () => screen.getByRole('button', { name: 'Share' });
const dialog = () => screen.getByRole('dialog', { name: 'Share board' });

describe('SharePanel (story 5, ui-component)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-22: copy → writeText called with the full link; "Link copied" shown until LINK_COPIED_MS, then back', async () => {
    vi.useFakeTimers();
    render(<SharePanel boardId={boardId} />);
    // fireEvent (not userEvent): userEvent's internal timers interact badly
    // with fake timers; the panel logic under test is click handlers.
    stubClipboard('resolve');

    fireEvent.click(shareButton());
    expect(dialog()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    // Flush the writeText().then() microtask.
    await act(async () => {});

    const writeText = (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText;
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

    // Still "copied" just before the timeout…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    });
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();

    // …and back to "Copy link" after it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('TC-23: writeText rejects → the link input is fully selected and the manual-copy message is shown', async () => {
    render(<SharePanel boardId={boardId} />);
    const user = userEvent.setup();
    stubClipboard('reject');

    await user.click(shareButton());
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(link);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-24: navigator.clipboard missing → same manual-copy fallback (no crash)', async () => {
    render(<SharePanel boardId={boardId} />);
    const user = userEvent.setup();
    stubClipboard('missing');

    await user.click(shareButton());
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });

  it('TC-25: Escape closes the panel; an outside click closes it; focus returns to the Share button', async () => {
    stubClipboard('resolve');
    render(<SharePanel boardId={boardId} />);
    const user = userEvent.setup();

    // Escape.
    await user.click(shareButton());
    expect(dialog()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(shareButton()).toHaveFocus();

    // Outside click.
    await user.click(shareButton());
    expect(dialog()).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
    expect(shareButton()).toHaveFocus();
  });
});
