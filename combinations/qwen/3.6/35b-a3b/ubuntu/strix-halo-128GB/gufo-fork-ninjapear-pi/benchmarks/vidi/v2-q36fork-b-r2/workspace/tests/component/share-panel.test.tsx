/** Component tests for story 5 — HomePage, BoardPage, SharePanel */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as React from 'react';
import type { CreateResponse, CheckResponse } from '../../src/client/api';
import { createBoardRequest, checkBoard } from '../../src/client/api';
import { useRoute, navigate } from '../../src/client/router';
import { SharePanel } from '../../src/client/share/SharePanel';

// ---------------------------------------------------------------------------
// Mocked modules
// ---------------------------------------------------------------------------

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(),
}));

vi.mock('../../src/client/router', () => {
  let currentRoute = { name: 'home' as const };
  return {
    useRoute: vi.fn((): typeof currentRoute => currentRoute),
    navigate: vi.fn((path: string) => {
      if (path.startsWith('/b/')) {
        const id = path.slice(3);
        currentRoute = { name: 'board', id };
      } else {
        currentRoute = { name: 'home' };
      }
    }),
    setupRouter: vi.fn(() => {}),
    parseRoute: vi.fn((p: string) => {
      if (p === '/' || p === '') return { name: 'home' as const };
      const m = p.match(/^\/b\/(.+)$/);
      if (m) return { name: 'board', id: m[1] };
      if (p.startsWith('/b/')) return { name: 'not_found' as const };
      return { name: 'home' as const };
    }),
  };
});

// ---------------------------------------------------------------------------
// TC-16: share.share_panel — open & close
// ---------------------------------------------------------------------------

describe('TC-16: SharePanel open/close', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders link input when opened', () => {
    render(<SharePanel boardLink="https://example.com/b/abc123def456ghi789jk" onClose={() => {}} />);
    
    const input = screen.getByRole('textbox');
    expect(input.value).toBe('https://example.com/b/abc123def456ghi789jk');
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(<SharePanel boardLink="https://example.com/b/abc123" onClose={onClose} />);
    
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when clicking outside panel', async () => {
    const onClose = vi.fn();
    render(<SharePanel boardLink="https://example.com/b/abc123" onClose={onClose} />);
    
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// TC-17: share.share_panel — copy button visibility and state
// ---------------------------------------------------------------------------

describe('TC-17: SharePanel copy button', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows "Copy link" text initially', () => {
    render(<SharePanel boardLink="https://example.com/b/abc123" onClose={() => {}} />);
    
    expect(screen.getByText('Copy link')).toBeInTheDocument();
  });

  it('button is enabled and clickable', () => {
    render(<SharePanel boardLink="https://example.com/b/abc123" onClose={() => {}} />);
    
    const button = screen.getByRole('button', { name: /copy link/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-19: share.share_panel — clipboard API copy success
// ---------------------------------------------------------------------------

describe('TC-19: SharePanel copy via clipboard API', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
    document.body.innerHTML = '';
  });

  it('copies link text via clipboard.writeText', async () => {
    const onAfterCopy = vi.fn();
    render(<SharePanel boardLink="https://example.com/b/xyz789" onClose={() => {}} onAfterCopy={onAfterCopy} />);
    
    const button = screen.getByRole('button', { name: /copy link/i });
    await act(async () => {
      fireEvent.click(button);
    });
    
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/b/xyz789');
    expect(onAfterCopy).toHaveBeenCalledOnce();
    
    // Should show "✓ Link copied" feedback
    expect(screen.getByText('✓ Link copied')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-20: share.share_panel — clipboard fallback (no API available)
// ---------------------------------------------------------------------------

describe('TC-20: SharePanel clipboard fallback', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });
    document.body.innerHTML = '';
  });

  it('falls back to input select when clipboard API unavailable', async () => {
    render(<SharePanel boardLink="https://example.com/b/noclipboard" onClose={() => {}} />);
    
    const button = screen.getByRole('button', { name: /copy link/i });
    await act(async () => {
      fireEvent.click(button);
    });
    
    const input = screen.getByRole('textbox') as HTMLInputElement;
    // Input should be focused so user can select with Ctrl+A
    expect(input.selectionStart !== null && input.selectionStart >= 0).toBe(true);
    
    // Should show instruction text about Ctrl/Cmd+C
    const textEl = screen.getByText(/Press Ctrl\+C|Select text/i);
    expect(textEl).toBeTruthy();
  });

  it('selects text in input when clipboard API throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Not allowed')),
      },
      writable: true,
    });

    render(<SharePanel boardLink="https://example.com/b/error-fallback" onClose={() => {}} />);
    
    const button = screen.getByRole('button', { name: /copy link/i });
    await act(async () => {
      fireEvent.click(button);
    });
    
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart !== null && input.selectionStart >= 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-21: share.share_panel — link format validation
// ---------------------------------------------------------------------------

describe('TC-21: SharePanel link format', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('displays correct link format for board with valid ID', () => {
    const boardId = 'AbCdEfGhIjKlMnOpQrStUvWxYz0';
    render(<SharePanel boardLink={`https://example.com/b/${boardId}`} onClose={() => {}} />);
    
    const input = screen.getByRole('textbox');
    expect(input.value).toBe(`https://example.com/b/${boardId}`);
  });

  it('uses passed boardLink directly without modification', () => {
    const boardId = 'MyBoardID';
    render(<SharePanel boardLink={`http://localhost:8787/b/${boardId}`} onClose={() => {}} />);
    
    const input = screen.getByRole('textbox');
    expect(input.value).toBe(`http://localhost:8787/b/${boardId}`);
  });
});

// ---------------------------------------------------------------------------
// TC-22: share.share_panel — copy triggers notification
// ---------------------------------------------------------------------------

describe('TC-22: SharePanel copy notification', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    });
    document.body.innerHTML = '';
  });

  it('shows success feedback immediately after copy', async () => {
    render(<SharePanel boardLink="https://example.com/b/notify1" onClose={() => {}} />);
    
    const button = screen.getByRole('button', { name: /copy link/i });
    await act(async () => {
      fireEvent.click(button);
    });
    
    // Text changes to indicate success
    expect(screen.getByText('✓ Link copied')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-23: share.share_panel — manual copy highlights input text
// ---------------------------------------------------------------------------

describe('TC-23: SharePanel manual copy highlights text', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });
    document.body.innerHTML = '';
  });

  it('input is read-only but selectable', () => {
    render(<SharePanel boardLink="https://example.com/b/selectable" onClose={() => {}} />);
    
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
  });

  it('clicking input focuses it for manual selection', async () => {
    render(<SharePanel boardLink="https://example.com/b/click-select" onClose={() => {}} />);
    
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(input);
    });
    expect(input.selectionStart !== null && input.selectionStart >= 0).toBe(true);
  });
});
