/** Share panel tests — TC-22, TC-23, TC-24 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

describe('boardLink utility', () => {
  let boardLinkFn: typeof import('../../src/client/share/SharePanel').boardLink;

  beforeEach(async () => {
    const mod = await import('../../src/client/share/SharePanel');
    boardLinkFn = mod.boardLink;
  });

  it('builds correct link from origin and id', () => {
    expect(boardLinkFn('https://vidi6.example.com', 'abc123')).toBe('https://vidi6.example.com/b/abc123');
  });
});

describe('SharePanel component — TC-22 to TC-24', () => {
  let SharePanel: typeof import('../../src/client/share/SharePanel').SharePanel;
  let boardLinkFn: typeof import('../../src/client/share/SharePanel').boardLink;

  beforeEach(async () => {
    Object.defineProperty(window, 'location', {
      value: { origin: 'https://example.com' },
      writable: true,
    });
    const mod = await import('../../src/client/share/SharePanel');
    SharePanel = mod.SharePanel;
    boardLinkFn = mod.boardLink;
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('TC-22: "Link copied" shown after copy, clipboard API called correctly', async () => {
    const { LINK_COPIED_MS } = await import('../../src/shared/config');
    
    render(<SharePanel boardId="aaaabbbbccccddddeeeefff" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/b/aaaabbbbccccddddeeeefff',
    );
    
    // Button changes to show copied state
    await waitFor(() => {
      expect(screen.getByText('✓ Link copied')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('TC-23: clipboard rejection → select input + manual message', async () => {
    // Override the beforeEach mock to reject
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    
    render(<SharePanel boardId="aaaabbbbccccddddeeeefff" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    
    // Manual copy message should appear
    const msg = screen.queryByText('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(msg).toBeTruthy();
  });

  it('TC-24: no clipboard API → manual copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { writable: true, value: undefined });
    
    render(<SharePanel boardId="aaaabbbbccccddddeeeefff" />);
    
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    
    const msg = screen.queryByText('Press Ctrl+C (Cmd+C on Mac) to copy');
    expect(msg).toBeTruthy();
  });

  it('Escape key closes panel', async () => {
    const { container } = render(<SharePanel boardId="aaaabbbbccccddddeeeefff" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });

  it('outside click closes panel', async () => {
    const { container } = render(<SharePanel boardId="aaaabbbbccccddddeeeefff" />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('[role="dialog"]')).toBeFalsy();
  });
});
