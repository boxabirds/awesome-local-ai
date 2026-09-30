import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharePanel, boardLink } from '@client/share/SharePanel';

const ID = 'abcdefghij0123456789AB';

function setClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => {
  // Remove any clipboard override installed for a test.
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

// TC-21: clipboard success -> "Link copied!" and no manual message.
describe('TC-21: Share copy success', () => {
  it('writes the full link and shows Link copied', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);

    render(<SharePanel boardId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    const expected = boardLink(window.location.origin, ID);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    const copyBtn = screen.getByRole('button', { name: /Link copied/i });
    expect(copyBtn).toBeInTheDocument();
    expect(screen.queryByText(/Copy link/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ctrl\+C/)).not.toBeInTheDocument();
  });
});

// TC-22: clipboard rejected -> manual message, field holds the full link, text selected.
describe('TC-22: Share copy fallback', () => {
  it('shows the manual-copy message, keeps the link, and selects the field', async () => {
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select');
    setClipboard(() => Promise.reject(new Error('denied')));

    render(<SharePanel boardId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() =>
      expect(
        screen.getByText(/blocked automatic copy.*Ctrl\+C/),
      ).toBeInTheDocument(),
    );

    const expected = boardLink(window.location.origin, ID);
    const field = screen.getByLabelText('Board link') as HTMLInputElement;
    expect(field.value).toBe(expected);
    expect(selectSpy).toHaveBeenCalled();
  });
});

// TC-24: Escape closes the panel and returns focus to the Share button.
describe('TC-24: Escape closes and restores focus', () => {
  it('closes on Escape and focuses the Share button', () => {
    render(<SharePanel boardId={ID} />);
    const shareBtn = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
    fireEvent.click(shareBtn);
    // Panel is open.
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    // Panel closed and focus returned to the Share button.
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(shareBtn);
  });
});

// TC-25: an outside pointerdown closes the panel.
describe('TC-25: outside click closes', () => {
  it('closes on pointerdown outside the panel', () => {
    render(<SharePanel boardId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });
});
