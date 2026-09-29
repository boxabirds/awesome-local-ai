// The address, the page it opens, and what that page does before it opens
// anything: a code is checked before it is joined, a code that is not a code is
// answered without a request, and the link the panel offers is the address that is
// in the bar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/client/App.tsx';
import {
  NullProvider,
  flush,
  panelHarness,
  probeWaits,
  setPath,
  type WaitProbe,
} from './story5TestUtils.tsx';
import { newBoardId } from '../../src/shared/board-id.ts';
import { BOARD_CHECK_RETRY_BASE_MS, RECONNECT_MAX_BACKOFF_MS } from '../../src/shared/config.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const exists = () => jsonResponse(200, { exists: true });

beforeEach(() => {
  setPath('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the address a board link opens', () => {
  it('TC-16: the link in the panel is the address in the bar', async () => {
    const boardId = newBoardId();
    setPath(`/b/${boardId}`);
    const fetchMock = vi.fn().mockResolvedValue(exists());
    vi.stubGlobal('fetch', fetchMock);

    render(<App makeProvider={() => new NullProvider()} />);
    await waitFor(() => expect(screen.getByTestId('viewport')).toBeTruthy());

    fireEvent.click(screen.getByTestId('share-button'));
    // Not "a URL that looks right" - the same string the visitor's bar shows, and
    // the address a second visitor would have to be given to arrive here.
    expect(panelHarness().linkValue()).toBe(`${window.location.origin}/b/${boardId}`);
    expect(panelHarness().linkValue()).toBe(window.location.href);
  });

  it('TC-23: a board the server cannot read offers nothing to copy', async () => {
    const boardId = newBoardId();
    setPath(`/b/${boardId}`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(exists()));
    let provider: NullProvider | null = null;

    render(
      <App
        makeProvider={() => {
          provider = new NullProvider();
          return provider;
        }}
      />,
    );
    await flush();
    expect(screen.getByTestId('viewport')).toBeTruthy();
    act(() => {
      provider!.connect();
    });

    // The panel is open while the board is still thought to be there, and then the
    // room says it cannot read this board. What was shareable a moment ago is not
    // shareable now, and the panel has to lose the copy, not keep it.
    fireEvent.click(screen.getByTestId('share-button'));
    expect(screen.getByTestId('copy-link-button')).not.toBeNull();
    act(() => {
      provider!.failToLoad();
    });

    expect(screen.getByTestId('share-button')).toBeDisabled();
    expect(screen.queryByTestId('copy-link-button')).toBeNull();
    expect(screen.getByTestId('share-disabled-note')).toBeTruthy();
    expect(screen.queryByText('Link copied')).toBeNull();
  });

  it('TC-23b: a link whose check cannot get an answer keeps being checked, waiting longer each time, and renders when the answer comes', async () => {
    const boardId = newBoardId();
    setPath(`/b/${boardId}`);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'server had a bad minute' }))
      .mockResolvedValue(exists());
    vi.stubGlobal('fetch', fetchMock);
    const waits: WaitProbe = probeWaits();

    render(<App makeProvider={() => new NullProvider()} />);
    // The first check has answered "no answer". Nothing about the board is
    // conclusive here, and a 404 is never fetched to find out.
    await flush();
    expect(screen.queryByTestId('viewport')).toBeNull();
    expect(screen.queryByTestId('not-found-page')).toBeNull();
    expect(screen.getByTestId('board-checking').getAttribute('data-state')).toBe('waiting');
    expect(waits.requested).toEqual([BOARD_CHECK_RETRY_BASE_MS]);

    await waits.settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('board-checking').getAttribute('data-state')).toBe('waiting');
    // The second wait is longer than the first.
    expect(waits.requested).toEqual([
      BOARD_CHECK_RETRY_BASE_MS,
      BOARD_CHECK_RETRY_BASE_MS * 2,
    ]);

    await waits.settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `/api/boards/${boardId}`,
      `/api/boards/${boardId}`,
      `/api/boards/${boardId}`,
    ]);
    expect(screen.queryByTestId('not-found-page')).toBeNull();
    waits.restore();
  });

  it('TC-24: a link that is answered "no board" asks once and does not ask again', async () => {
    const boardId = newBoardId();
    setPath(`/b/${boardId}`);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'not_found' }));
    vi.stubGlobal('fetch', fetchMock);
    const waits = probeWaits();

    render(<App makeProvider={() => new NullProvider()} />);
    await flush();
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A page that retried its 404 into rendering would be the same page claiming a
    // board was there. Waits grow for a board that has not answered, never for a
    // board that has answered.
    await waits.settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(waits.requested).toEqual([]);
    expect(screen.queryByTestId('viewport')).toBeNull();
    expect(screen.getByTestId('home-link')).toBeTruthy();
    waits.restore();
  });

  it('TC-25: an address that cannot be a code is answered without a request and without a connection', () => {
    const fetchMock = vi.fn();
    const webSocket = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('WebSocket', webSocket);
    setPath('/b/short');

    render(<App makeProvider={() => new NullProvider()} />);

    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(webSocket).not.toHaveBeenCalled();
    expect(screen.queryByTestId('viewport')).toBeNull();
    // Exactly one way onward, and it is the start page.
    expect(screen.getAllByTestId('home-link')).toHaveLength(1);
  });

  it('a board address opens its own page, and the back button leaves it', async () => {
    const boardId = newBoardId();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(exists()));
    render(<App makeProvider={() => new NullProvider()} />);

    // Start page first: no board, no request about one.
    expect(screen.getByTestId('create-board')).toBeTruthy();
    expect(screen.queryByTestId('viewport')).toBeNull();

    act(() => {
      window.history.pushState(null, '', `/b/${boardId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.getByTestId('viewport')).toBeTruthy());

    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(screen.getByTestId('create-board')).toBeTruthy());
    expect(screen.queryByTestId('viewport')).toBeNull();
  });

  it('TC-31: the waits for a link that has not answered grow, stop at the ceiling, and never run two at once', async () => {
    const boardId = newBoardId();
    setPath(`/b/${boardId}`);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('still down'));
    vi.stubGlobal('fetch', fetchMock);
    const waits = probeWaits();

    render(<App makeProvider={() => new NullProvider()} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Each wait is asked for, then run, and each run asks for exactly one more.
    // The ceiling is the one the socket already uses for a board that is slow to
    // come back, so a link that cannot be checked does not become its own storm.
    for (const wait of [1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000]) {
      expect(waits.requested[waits.requested.length - 1]).toBe(wait);
      await waits.settle();
      // One check per wait asked for, and no wait asked for without a check.
      expect(fetchMock).toHaveBeenCalledTimes(waits.requested.length);
    }
    expect(waits.requested[waits.requested.length - 1]).toBe(RECONNECT_MAX_BACKOFF_MS);
    waits.restore();
  });
});
