/**
 * Home page component tests (TC-16, TC-17, TC-19).
 *
 * Tests: heading present, New board button behavior (success → navigate,
 * failure → error message + re-enable), loading state while creating.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../../../src/client/pages/HomePage';

// Mock the api module
vi.mock('../../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
}));

import { createBoardRequest } from '../../../src/client/api';

// Mock navigate so we can verify calls
const mockNavigate = vi.fn();
vi.mock('../../../src/client/router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/client/router')>();
  return { ...mod, navigate: (path: string) => mockNavigate(path) };
});

describe('HomePage (TC-16)', () => {
  beforeEach(() => {
    vi.mocked(createBoardRequest).mockReset();
    mockNavigate.mockReset();
  });

  test('TC-16: heading is visible, no board viewport or toolbar rendered', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('vidi6');
    expect(screen.queryByTestId('board-viewport')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-sticky-button')).not.toBeInTheDocument();
  });

  test('TC-17: click New board while create resolves → navigates to /b/:id', async () => {
    const user = userEvent.setup();
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'created', id: 'abcdefghijklmnopqrstuv' });

    render(<HomePage />);
    const button = screen.getByRole('button', { name: /new board/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/b/abcdefghijklmnopqrstuv');
    });
  });

  test('TC-19: click New board while create fails → shows error message, button re-enabled', async () => {
    const user = userEvent.setup();
    vi.mocked(createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const button = screen.getByRole('button', { name: /new board/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't create a board. Please try again.",
      );
    });
    // Button is re-enabled
    expect(screen.getByRole('button', { name: /new board/i })).toBeEnabled();
  });

  test('button shows creating state while request is pending', async () => {
    let resolve!: (value: { kind: 'failed' }) => void;
    vi.mocked(createBoardRequest).mockReturnValue(new Promise((r) => { resolve = r; }));

    const user = userEvent.setup();
    render(<HomePage />);
    const button = screen.getByRole('button', { name: /new board/i });
    await user.click(button);

    // While pending, button is disabled
    expect(button).toBeDisabled();

    // Resolve to cleanup
    await act(async () => { resolve({ kind: 'failed' }); });
  });
});
