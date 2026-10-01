// Story 5, client.story5_share_link (TC-16, TC-17, TC-18): the Home page. The
// page's own logic — its two state labels, the exact failure copy the PRD names,
// and the promise that a click creates exactly one board — is tested here against
// a mocked `api.ts`, on jsdom with React, exactly as the design's Test scope asks
// ("component tests over a mocked api.ts"). What it looks like to a person is the
// end-to-end tier's job.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { createBoardRequest } from '../../src/client/api';
import { CREATE_FAILED_MESSAGE } from '../../src/client/pages/state';

vi.mock('../../src/client/api', () => ({
  createBoardRequest: vi.fn(),
  checkBoard: vi.fn(async () => ({ kind: 'not_found' })),
}));

const mockedCreate = vi.mocked(createBoardRequest);

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.clearAllMocks();
});

describe('TC-16: the Home page and its New board button', () => {
  it('shows the product name, the line and a prominent New board button', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'vidi6' })).toBeTruthy();
    expect(screen.getByText('A shared board for thinking together')).toBeTruthy();
    // The one call a test makes to reach the button is `.click()`.
    expect(screen.getByRole('button', { name: 'New board' })).toBeTruthy();
  });

  it('reads "Creating…" and is disabled while a board is being made', () => {
    // A create that never settles, so the button can be observed mid-flight.
    mockedCreate.mockReturnValue(new Promise(() => {}));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    const button = screen.getByRole('button', { name: 'Creating…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('navigates to the new board when creation succeeds', async () => {
    const id = 'p1Chvj4mAlXsf8Ue0YUGHw';
    mockedCreate.mockResolvedValue({ kind: 'created', id });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
  });
});

describe('TC-17: a create that fails says so, in the exact words the PRD gives', () => {
  it('shows the exact message, enables the button and stays on Home', async () => {
    mockedCreate.mockResolvedValue({ kind: 'failed' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    // The exact PRD copy is a value the page and this test share.
    expect(CREATE_FAILED_MESSAGE).toBe("Couldn't create a board. Please try again.");
    expect(await screen.findByRole('alert')).toHaveTextContent(CREATE_FAILED_MESSAGE);
    // The button is enabled again, and the person is still on the Home page.
    const button = screen.getByRole('button', { name: 'New board' });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(window.location.pathname).toBe('/');
  });
});

describe('TC-18: a click creates exactly one board', () => {
  it('asks the service for one board per click', async () => {
    mockedCreate.mockResolvedValue({ kind: 'created', id: 'p1Chvj4mAlXsf8Ue0YUGHw' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });
});
