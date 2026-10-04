/**
 * Story 5 page component tests:
 * - TC-16 Home: New board → "Creating…" → navigates to /b/<id>.
 * - TC-17 Create failure (500 AND network error) → failure message, button
 *   re-enabled for another attempt.
 * - TC-19 Malformed id → Board not found without ANY request (negative).
 * - TC-20 Unknown valid id → "Opening board…" → Board not found.
 * - TC-21 Flaky service on open → "Couldn't reach vidi6. Retrying…" with
 *   backoff → board opens without a reload when the service recovers.
 *
 * `fetch` is mocked (not api.ts) so both failure sources — a 500 response
 * and a thrown network error — run through the real api.ts mapping.
 * `connectBoard` is mocked so the ready board renders without a WebSocket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../../src/client/sync/connectBoard', () => ({
  canEdit: (state: string) => state !== 'load_failed',
  connectBoard: () => ({ destroy: () => {} }),
}));

import { HomePage } from '../../src/client/pages/HomePage';
import { BoardPage } from '../../src/client/pages/BoardPage';
import { CREATE_FAILED_MESSAGE } from '../../src/client/pages/state';

const VALID_ID = 'aB3dE6gH9jK2mN5pQ8rS1t';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('story 5 pages', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('TC-16: New board → "Creating…" while creating → navigates to /b/<id>', async () => {
    let resolveCreate!: (res: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    const fetchMock = mockFetch(async (_input, init) => {
      if (init?.method === 'POST') return pending;
      return jsonResponse(404, { error: 'not_found' });
    });

    render(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));

    // "Creating…" and disabled while the request is in flight.
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();

    const id = 'zZ8yX7wV6uT5sR4qP3oN2m';
    await act(async () => {
      resolveCreate(jsonResponse(201, { id }));
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/b/${id}`));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TC-17: create failure (500 and network) → message; button re-enabled', async () => {
    const fetchMock = mockFetch(async (_input, init) => {
      if (init?.method !== 'POST') return jsonResponse(404, { error: 'not_found' });
      // First attempt: 500. Second attempt: network error (throw).
      if (fetchMock.mock.calls.length === 1) {
        return jsonResponse(500, { error: 'create_failed' });
      }
      return Promise.reject(new TypeError('Failed to fetch'));
    });

    render(<HomePage />);

    // First attempt → 500 → failure message; the button re-enables.
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await screen.findByText(CREATE_FAILED_MESSAGE);
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();

    // Second attempt → network error → the same message again.
    fireEvent.click(screen.getByRole('button', { name: 'New board' }));
    await waitFor(() =>
      expect(screen.getAllByText(CREATE_FAILED_MESSAGE).length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByRole('button', { name: 'New board' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TC-19: malformed id → Board not found without any request (negative)', async () => {
    const fetchMock = mockFetch(async () => jsonResponse(404, { error: 'not_found' }));

    window.history.pushState(null, '', '/b/not-a-board-id');
    render(<BoardPage id="not-a-board-id" />);

    expect(screen.getByText('Board not found')).toBeVisible();
    expect(screen.getByText('Check the link, or ask the person who shared it to send it again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New board' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TC-20: unknown valid id → "Opening board…" → Board not found', async () => {
    mockFetch(async () => jsonResponse(404, { error: 'not_found' }));

    render(<BoardPage id={VALID_ID} />);
    expect(screen.getByText('Opening board…')).toBeVisible();
    await screen.findByText('Board not found');
    expect(screen.getByRole('button', { name: 'New board' })).toBeVisible();
  });

  it('TC-21: flaky service → retry message with backoff → board opens (no reload)', async () => {
    vi.useFakeTimers();

    const results: Array<Response | 'network'> = ['network', 'network', jsonResponse(200, { id: VALID_ID })];
    let call = 0;
    const fetchMock = mockFetch(async () => {
      const r = results[call++];
      if (r === 'network') throw new TypeError('Failed to fetch');
      return r;
    });

    render(<BoardPage id={VALID_ID} />);
    expect(screen.getByText('Opening board…')).toBeVisible();

    // First check fails (microtasks) → retry message.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff 1 s → second check fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeVisible();

    // Backoff 2 s → service recovers → the board renders (no reload).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(document.querySelector('.board-viewport')).not.toBeNull();
    expect(screen.queryByText("Couldn't reach vidi6. Retrying…")).toBeNull();
  });
});
