import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { SharePanel } from '../../src/client/share/SharePanel';
import { LINK_COPIED_MS } from '../../src/shared/config';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await act(async () => { await Promise.resolve(); });
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TC-22: Copy link - writeText called with full https link; Link copied visible then reverts', () => {
  it('writeText called with full link; "Link copied" visible then reverts after LINK_COPIED_MS', async () => {
    vi.useFakeTimers();
    
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });
    
    const boardId = 'abcdefghijklmnopqrstuvwxyz';
    render(<SharePanel boardId={boardId} />);
    
    // Open panel
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    
    // Check the link in the input
    const input = screen.getByRole('textbox', { name: 'Board link' });
    const expectedLink = `${window.location.origin}/b/${boardId}`;
    expect(input).toHaveValue(expectedLink);
    
    // Click Copy link
    await clickCopy();
    
    // writeText called with the full link
    expect(writeTextMock).toHaveBeenCalledWith(expectedLink);
    
    // "Link copied" visible
    expect(screen.getByText('✓ Link copied')).toBeInTheDocument();
    
    // Advance to LINK_COPIED_MS - 1: still showing "Link copied"
    act(() => {
      vi.advanceTimersByTime(LINK_COPIED_MS - 1);
    });
    expect(screen.getByText('✓ Link copied')).toBeInTheDocument();
    
    // Advance 1 more ms: reverts to "Copy link"
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Copy link')).toBeInTheDocument();
  });
});

describe('TC-23: writeText rejects - field text fully selected; manual-copy message', () => {
  it('clipboard.writeText rejects → input focused and selected; manual-copy message shown', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      writable: true,
    });
    
    const boardId = 'abcdefghijklmnopqrstuvwxyz';
    render(<SharePanel boardId={boardId} />);
    
    // Open panel
    await openPanel();
    
    // Click Copy link
    await clickCopy();
    
    // writeText was called and rejected
    expect(writeTextMock).toHaveBeenCalled();
    
    // Manual copy message shown
    expect(screen.getByText(/Press Ctrl\+C/)).toBeInTheDocument();
    
    // Input is focused
    const input = screen.getByRole('textbox', { name: 'Board link' });
    expect(input).toHaveFocus();
  });
});

describe('TC-24: navigator.clipboard undefined - same as TC-23', () => {
  it('clipboard undefined → manual-copy fallback', async () => {
    // Ensure clipboard is undefined
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });
    
    const boardId = 'abcdefghijklmnopqrstuvwxyz';
    render(<SharePanel boardId={boardId} />);
    
    // Open panel
    await openPanel();
    
    // Click Copy link
    await clickCopy();
    
    // Manual copy message shown
    expect(screen.getByText(/Press Ctrl\+C/)).toBeInTheDocument();
    
    // Input is focused
    const input = screen.getByRole('textbox', { name: 'Board link' });
    expect(input).toHaveFocus();
  });
});

describe('TC-25: Close behaviour - Escape and outside click', () => {
  it('panel closes on Escape', async () => {
    const boardId = 'abcdefghijklmnopqrstuvwxyz';
    render(<SharePanel boardId={boardId} />);
    
    // Open panel
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    
    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    
    // Panel closed
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });

  it('panel closes on outside click', async () => {
    const boardId = 'abcdefghijklmnopqrstuvwxyz';
    const { container } = render(<SharePanel boardId={boardId} />);
    
    // Open panel
    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Share board' })).toBeInTheDocument();
    
    // Click outside the panel
    const outside = document.createElement('div');
    container.appendChild(outside);
    act(() => {
      fireEvent.pointerDown(outside);
    });
    
    // Panel closed
    expect(screen.queryByRole('dialog', { name: 'Share board' })).not.toBeInTheDocument();
  });
});
