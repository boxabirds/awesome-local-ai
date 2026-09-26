import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import * as api from '../../src/client/api';

/**
 * Component tests for share.pages (TC-16 to TC-21).
 * api.ts is mocked; page state machines are under test.
 */

vi.mock('../../src/client/api');

beforeEach(() => {
  window.history.pushState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('TC-16: click Create a board → Creating… disabled → navigate to /b/<id>', async () => {
    const mockCreate = vi.mocked(api.createBoardRequest);
    let resolveCreate!: (value: api.CreateResponse) => void;
    mockCreate.mockReturnValue(new Promise((r) => { resolveCreate = r; }));

    render(<HomePage />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    // Button shows "Creating…" and is disabled
    expect(button.textContent).toBe('Creating…');
    expect(button.hasAttribute('disabled')).toBe(true);

    // Resolve with a created board
    resolveCreate({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/b/abcdefghijklmnopqrstuv');
    });
  });

  it('TC-17 (500): failed → exact message, button enabled, still on /', async () => {
    const mockCreate = vi.mocked(api.createBoardRequest);
    mockCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
    });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('TC-17 (network): failed → exact message, button enabled, still on /', async () => {
    const mockCreate = vi.mocked(api.createBoardRequest);
    mockCreate.mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "Couldn't create a board. Please try again.",
      );
    });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('TC-18: rate_limited → exact rate-limit message, button enabled', async () => {
    const mockCreate = vi.mocked(api.createBoardRequest);
    mockCreate.mockResolvedValue({ kind: 'rate_limited' });

    render(<HomePage />);

    const button = screen.getByRole('button');
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "You're creating boards too quickly. Wait a minute and try again.",
      );
    });
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

describe('BoardPage', () => {
  it('TC-19: malformed id → NotFoundPage; checkBoard never called', () => {
    const mockCheck = vi.mocked(api.checkBoard);
    render(<BoardPage id="bad" />);

    expect(screen.getByText('Board not found')).toBeDefined();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('TC-20: valid id → "Opening board…" → not_found → NotFoundPage', async () => {
    const mockCheck = vi.mocked(api.checkBoard);
    let resolveCheck!: (value: api.CheckResponse) => void;
    mockCheck.mockReturnValue(new Promise((r) => { resolveCheck = r; }));

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);

    expect(screen.getByText('Opening board…')).toBeDefined();

    resolveCheck({ kind: 'not_found' });
    await waitFor(() => {
      expect(screen.getByText('Board not found')).toBeDefined();
    });
    expect(screen.getByText('Create a new board')).toBeDefined();
  });

  it('TC-21: unreachable twice then exists → retry message → board', async () => {
    const mockCheck = vi.mocked(api.checkBoard);
    // After the 'once' values are consumed, default to 'exists' to avoid
    // any spurious re-checks from throwing.
    mockCheck.mockResolvedValue({ kind: 'exists' });
    mockCheck
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'exists' });

    render(<BoardPage id="abcdefghijklmnopqrstuv" />);

    // After first unreachable, shows retry message
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeDefined();
    });

    // Advance past first backoff (1000ms) — triggers second call
    await new Promise((r) => setTimeout(r, 1100));

    // After second unreachable, still showing retry
    await waitFor(() => {
      expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeDefined();
    });

    // Advance past second backoff (2000ms) — triggers third call which succeeds
    await new Promise((r) => setTimeout(r, 2100));

    // Board rendered: retry message gone
    await waitFor(() => {
      expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
    });

    // At least 3 calls (first unreachable, second unreachable, then exists)
    expect(mockCheck.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
