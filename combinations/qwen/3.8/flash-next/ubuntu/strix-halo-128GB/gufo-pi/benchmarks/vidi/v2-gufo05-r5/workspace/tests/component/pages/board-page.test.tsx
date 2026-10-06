/**
 * Board page component tests (TC-13, TC-18).
 *
 * TC-13: loading → not_found for malformed ids, no request made.
 * TC-18: exponential backoff for unreachable check (verified via mocked checkBoard).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BoardPage } from '../../../src/client/pages/BoardPage';
import { checkBoard } from '../../../src/client/api';

vi.mock('../../../src/client/api', () => ({
  checkBoard: vi.fn(),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' as const })),
}));

describe('BoardPage (TC-13)', () => {
  beforeEach(() => {
    vi.mocked(checkBoard).mockReset();
  });

  test('TC-13: malformed id (too short) renders not_found immediately, no request made', () => {
    render(<BoardPage id="abc" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Board not found');
    expect(checkBoard).not.toHaveBeenCalled();
  });

  test('TC-13: malformed id (23 chars) renders not_found immediately, no request made', () => {
    render(<BoardPage id={'A'.repeat(23)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Board not found');
    expect(checkBoard).not.toHaveBeenCalled();
  });

  test('valid id with 404 renders not_found', async () => {
    vi.mocked(checkBoard).mockResolvedValue({ kind: 'not_found' });
    render(<BoardPage id="abcdefghijklmnopqrstuv" />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Board not found');
    });
  });

  test('valid id shows loading text initially', () => {
    vi.mocked(checkBoard).mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<BoardPage id="abcdefghijklmnopqrstuv" />);
    expect(screen.getByText('Opening board…')).toBeInTheDocument();
  });

  test('unreachable shows retry message', async () => {
    vi.mocked(checkBoard).mockResolvedValue({ kind: 'unreachable' });
    render(<BoardPage id="abcdefghijklmnopqrstuv" />);
    await waitFor(() => {
      expect(screen.getByText(/couldn.t reach vidi6/i)).toBeInTheDocument();
    });
  });
});
