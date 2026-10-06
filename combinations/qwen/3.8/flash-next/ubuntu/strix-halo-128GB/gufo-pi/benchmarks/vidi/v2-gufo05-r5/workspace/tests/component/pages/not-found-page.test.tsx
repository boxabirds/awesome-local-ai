/**
 * Not found page component tests (TC-20).
 *
 * Tests: heading, guidance text, New board button, and link home.
 */
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotFoundPage } from '../../../src/client/pages/NotFoundPage';

vi.mock('../../../src/client/api', () => ({
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' as const })),
}));

vi.mock('../../../src/client/router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/client/router')>();
  return { ...mod, navigate: vi.fn() };
});

describe('NotFoundPage (TC-20)', () => {
  test('TC-20: heading, guidance text, New board button, and link home are present', () => {
    render(<NotFoundPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Board not found');
    expect(
      screen.getByText('Check the link, or ask the person who shared it to send it again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new board/i })).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/');
  });
});
