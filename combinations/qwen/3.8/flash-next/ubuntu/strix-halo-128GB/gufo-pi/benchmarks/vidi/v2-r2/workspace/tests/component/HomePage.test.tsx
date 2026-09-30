import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { HomePage } from '@client/pages/HomePage';
import * as api from '@client/api';
import { navigate } from '@client/router';

vi.mock('@client/api');
vi.mock('@client/router', async () => {
  const actual = await vi.importActual<typeof import('@client/router')>('@client/router');
  return { ...actual, navigate: vi.fn() };
});

beforeEach(() => {
  vi.mocked(api.createBoardRequest).mockReset();
  vi.mocked(navigate).mockReset();
});

// TC-16: Home "New board" click sends one create request, shows Creating… (disabled)
// while in flight, then navigates to /b/<id>. A second click sends no extra request.
describe('TC-16: Home New board navigates', () => {
  it('shows Creating…, disables the button, then navigates once', async () => {
    let resolveCreate!: (v: api.CreateResponse) => void;
    vi.mocked(api.createBoardRequest).mockImplementation(
      () => new Promise<api.CreateResponse>((res) => (resolveCreate = res)),
    );

    render(<HomePage />);
    const btn = screen.getByRole('button', { name: 'New board' });

    fireEvent.click(btn);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);
    expect(btn).toHaveTextContent('Creating…');
    expect(btn).toBeDisabled();

    // A second click while in flight does nothing (button is disabled).
    fireEvent.click(btn);
    expect(api.createBoardRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({ kind: 'created', id: 'abc123XYZ_-0123456789ab' });
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/b/abc123XYZ_-0123456789ab');
  });
});

// TC-17: create failed -> error message, stays on home, retry re-sends.
describe('TC-17: Home create failure stays put with a message', () => {
  it('shows the create-failed message and allows a retry', async () => {
    vi.mocked(api.createBoardRequest).mockResolvedValue({ kind: 'failed' });

    render(<HomePage />);
    const btn = screen.getByRole('button', { name: 'New board' });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't create a board. Please try again.",
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
    // Button returns to its normal, enabled state so the action can be retried.
    await waitFor(() => expect(btn).toBeEnabled());
    expect(btn).toHaveTextContent('New board');

    // Retrying sends a fresh request.
    fireEvent.click(btn);
    await waitFor(() => expect(api.createBoardRequest).toHaveBeenCalledTimes(2));
  });
});
