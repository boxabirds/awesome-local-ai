import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SharePanel, boardLink } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

const BOARD_ID = 'abcdefghijklmnopqrstuv';
const ORIGIN = window.location.origin;

describe('boardLink', () => {
  it('constructs the full board URL', () => {
    expect(boardLink('https://vidi6.example.com', BOARD_ID)).toBe(`https://vidi6.example.com/b/${BOARD_ID}`);
  });
});

function setClipboard(mock: { writeText: ReturnType<typeof vi.fn> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

describe('TC-22: SharePanel - copy link succeeds', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText: writeTextMock });
  });

  afterEach(() => {
    setClipboard(undefined);
    vi.useRealTimers();
  });

  it('writeText called with full link; Link copied at LINK_COPIED_MS-1, reverted at LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    render(<SharePanel boardId={BOARD_ID} />);

    // Open panel with fireEvent
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    // Panel is open
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue(`${ORIGIN}/b/${BOARD_ID}`);

    // Click Copy link
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    // Let the promise resolve
    await act(async () => { vi.advanceTimersByTime(0); });

    // writeText was called with the full link
    expect(writeTextMock).toHaveBeenCalledWith(`${ORIGIN}/b/${BOARD_ID}`);

    // "Link copied" is visible
    expect(screen.getByText(/Link copied/)).toBeInTheDocument();

    // At LINK_COPIED_MS - 1: still visible
    await act(async () => { vi.advanceTimersByTime(LINK_COPIED_MS - 1); });
    expect(screen.getByText(/Link copied/)).toBeInTheDocument();

    // At exactly LINK_COPIED_MS: reverted back to "Copy link"
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByText(/Link copied/)).not.toBeInTheDocument();
  });
});

describe('TC-23: SharePanel - clipboard rejected triggers manual copy', () => {
  it('writeText rejects: input is selected, manual-copy message shown', async () => {
    const user = userEvent.setup();
    // Must set clipboard AFTER userEvent.setup() since it patches navigator.clipboard
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    render(<SharePanel boardId={BOARD_ID} />);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });

    // Input should have the full text selected
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(`${ORIGIN}/b/${BOARD_ID}`.length);
    setClipboard(undefined);
  });
});

describe('TC-24: SharePanel - clipboard API missing triggers manual copy', () => {
  it('navigator.clipboard undefined: input selected, manual-copy message', async () => {
    const user = userEvent.setup();
    // Must set clipboard AFTER userEvent.setup()
    setClipboard(undefined);
    render(<SharePanel boardId={BOARD_ID} />);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(screen.getByText('Press Ctrl+C (Cmd+C on Mac) to copy')).toBeInTheDocument();
    });

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(`${ORIGIN}/b/${BOARD_ID}`.length);
  });
});

describe('TC-25: SharePanel - closes on Escape and outside click', () => {
  beforeEach(() => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    setClipboard(undefined);
  });

  it('Escape closes the panel', async () => {
    const user = userEvent.setup();
    render(<SharePanel boardId={BOARD_ID} />);

    // Open panel
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    // Press Escape
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });

  it('outside pointerdown closes the panel', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">Outside content</div>
        <SharePanel boardId={BOARD_ID} />
      </div>,
    );

    // Open panel
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();

    // Click outside
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });
});
