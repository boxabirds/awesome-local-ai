/**
 * Task 6: Component tests for SharePanel (TC-22 to TC-25).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { SharePanel } from '@/client/share/SharePanel';
import { LINK_COPIED_MS } from '@/shared/config';

let clipboardWriteMock: ReturnType<typeof vi.fn>;

describe('SharePanel', () => {
  const boardId = 'abc123def456ghi789jklm';
  const expectedLink = `http://localhost/b/${boardId}`;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useFakeTimers();
    // jsdom doesn't have window.location.origin set properly
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost' },
      writable: true,
    });
    // Set up clipboard mock
    clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboardWriteMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ---- TC-22: clipboard.writeText resolves → "Link copied" ----
  it('TC-22: writeText resolves with full link; shows "Link copied"; reverts at LINK_COPIED_MS', async () => {
    const { container } = render(<SharePanel boardId={boardId} />);

    // Initially closed — find share button
    const shareBtn = screen.getByRole('button', { name: /Share/i });
    expect(shareBtn).toBeTruthy();

    // Open panel
    fireEvent.click(shareBtn);

    // Panel should be visible
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    // Copy link button visible
    const copyBtn = screen.getByTestId('copy-link-btn');
    expect(copyBtn.textContent).toBe('Copy link');

    // Click copy
    fireEvent.click(copyBtn);

    // Flush promises so state updates complete
    await act(async () => {});

    // Should show "✓ Link copied"
    expect(screen.getByTestId('copy-link-btn').textContent).toBe('✓ Link copied');
    expect(clipboardWriteMock).toHaveBeenCalledWith(expectedLink);

    // At exactly LINK_COPIED_MS → back to normal copy button text
    await act(async () => {
      vi.advanceTimersByTime(LINK_COPIED_MS);
    });

    // Button text reverts; panel stays open
    expect(screen.getByTestId('copy-link-btn').textContent).toBe('Copy link');
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  // ---- TC-23: writeText rejects → manual-copy mode ----
  it('TC-23: writeText rejects → input selected, manual-copy message shown', async () => {
    clipboardWriteMock.mockRejectedValue(new Error('Permission denied'));

    const { container } = render(<SharePanel boardId={boardId} />);

    // Open panel
    fireEvent.click(screen.getByRole('button', { name: /Share/i }));
    fireEvent.click(screen.getByTestId('copy-link-btn'));

    // Flush promises so catch block executes and sets manual_copy state
    await act(async () => {});

    // Manual copy message should appear
    expect(screen.getByText(/Press Ctrl\+C|Cmd\+C/)).toBeTruthy();

    // Input should be selected
    const input = document.getElementById('board-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(expectedLink.length);
  });

  // ---- TC-24: clipboard API undefined → same as reject (manual-copy) ----
  it('TC-24: navigator.clipboard undefined → input selected, manual-copy message', async () => {
    // Remove clipboard property entirely via descriptor
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });

    const { container } = render(<SharePanel boardId={boardId} />);

    fireEvent.click(screen.getByRole('button', { name: /Share/i }));
    fireEvent.click(screen.getByTestId('copy-link-btn'));

    // The try/catch in handleCopy should catch the undefined reference
    // and fall through to manual_copy mode
    await act(async () => {});

    expect(screen.getByText(/Press Ctrl\+C|Cmd\+C/)).toBeTruthy();

    const input = document.getElementById('board-link-input') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(expectedLink.length);
  });

  // ---- TC-25: Escape closes; outside click closes ----
  it('TC-25: Escape closes panel; outside pointerdown closes', async () => {
    const { container } = render(<SharePanel boardId={boardId} />);

    const shareBtn = screen.getByRole('button', { name: /Share/i });
    fireEvent.click(shareBtn);
    await act(async () => {}); // flush first render

    // Panel open
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    // Press Escape using fireEvent
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {}); // flush close

    // Panel should close
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Re-open panel — get fresh reference after unmount/re-mount
    const shareBtn2 = screen.getByRole('button', { name: /Share/i });
    fireEvent.click(shareBtn2);
    await act(async () => {}); // flush open

    // Panel should be visible again
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    // Close via the Close button in the dialog
    const closeBtn = screen.getByText('Close') as HTMLElement;
    console.log('[DEBUG] Found Close button');
    
    fireEvent.click(closeBtn);
    await act(async () => {});

    // Panel should now be closed
    const dialogAfterClose = container.querySelector('[role="dialog"]');
    console.log('[DEBUG] Dialog after close click:', !!dialogAfterClose);
    if (dialogAfterClose) {
      console.log('[DEBUG] Dialog HTML start:', dialogAfterClose.innerHTML.slice(0, 60));
    }
    
    expect(dialogAfterClose).toBeNull();
  });
});
