// The one button on the start page, and the three ways it can not work. A press
// that is told to wait, a press the server refused, and a press that never got an
// answer are three different things to say, and none of them is the not-found page
// and none of them is a link that goes nowhere.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/client/App.tsx';
import { HomePage } from '../../src/client/pages/HomePage.tsx';
import { NullProvider, flush, setPath } from './story5TestUtils.tsx';
import type { CreateBoardResult } from '../../src/client/api.ts';
import { newBoardId } from '../../src/shared/board-id.ts';

beforeEach(() => {
  setPath('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the button that makes a board', () => {
  it('TC-18: a press that is told to wait is told to wait, in its own page', async () => {
    const createRequest = vi.fn(async (): Promise<CreateBoardResult> => ({ kind: 'rate_limited' }));
    const onCreated = vi.fn();
    render(<HomePage onCreated={onCreated} createRequest={createRequest} />);

    fireEvent.click(screen.getByTestId('create-board'));
    await waitFor(() => expect(screen.getByTestId('create-message')).toBeTruthy());

    expect(screen.getByTestId('create-message').textContent).toMatch(/too quickly/i);
    // Nothing was opened: the visitor who is told to wait is not sent to a page
    // that says there is no board here.
    expect(onCreated).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    // And the button is a button again: this press was answered, however badly.
    expect(screen.getByTestId('create-board')).not.toBeDisabled();
  });

  it('TC-19: presses in a row mean one board, not two requests and not two answers', async () => {
    let finish: (result: CreateBoardResult) => void = () => {};
    const createRequest = vi.fn(
      () =>
        new Promise<CreateBoardResult>((resolve) => {
          finish = resolve;
        }),
    );
    const onCreated = vi.fn();
    render(<HomePage onCreated={onCreated} createRequest={createRequest} />);

    fireEvent.click(screen.getByTestId('create-board'));
    fireEvent.click(screen.getByTestId('create-board'));
    expect(createRequest).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');

    finish({ kind: 'created', boardId: newBoardId() });
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it('TC-19b: an answer that arrives late does not describe the next press', async () => {
    let finish: (result: CreateBoardResult) => void = () => {};
    const createRequest = vi.fn(
      () =>
        new Promise<CreateBoardResult>((resolve) => {
          finish = resolve;
        }),
    );
    const onCreated = vi.fn();
    render(<HomePage onCreated={onCreated} createRequest={createRequest} />);

    // First press: nothing was created, and the page says so.
    fireEvent.click(screen.getByTestId('create-board'));
    finish({ kind: 'failed' });
    await waitFor(() => expect(screen.getByTestId('create-message')).toBeTruthy());
    expect(screen.getByTestId('create-message').textContent).toMatch(/couldn.t create/i);

    // Second press: this one works, and takes the visitor to the board. The
    // message from the first press is not there to be read beside it.
    fireEvent.click(screen.getByTestId('create-board'));
    const boardId = newBoardId();
    finish({ kind: 'created', boardId });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(boardId));
    expect(screen.queryByTestId('create-message')).toBeNull();
  });

  it('TC-29: a press that never gets an answer says so in the page, and is not silent', async () => {
    const createRequest = vi.fn((): Promise<CreateBoardResult> => Promise.reject(new Error('boom')));
    const onCreated = vi.fn();
    render(<HomePage onCreated={onCreated} createRequest={createRequest} />);

    fireEvent.click(screen.getByTestId('create-board'));
    await waitFor(() => expect(screen.getByTestId('create-message')).toBeTruthy());

    // A visible, specific line in an element that announces it, not a button that
    // quietly stopped doing anything.
    expect(screen.getByTestId('create-message').getAttribute('role')).toBe('alert');
    // The sentence the PRD gives for a service that would not answer: a visitor who
    // cannot reach the service is not told something narrower than they can act on.
    expect(screen.getByTestId('create-message').textContent).toBe(
      "Couldn't create a board. Please try again.",
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');

    // Still a button afterwards: the press was answered, and answering it is what
    // the message is.
    createRequest.mockResolvedValue({ kind: 'created', boardId: newBoardId() });
    fireEvent.click(screen.getByTestId('create-board'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it('a board that was created is opened at its own address', async () => {
    const boardId = newBoardId();
    setPath('/');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/boards'
        ? new Response(JSON.stringify({ id: boardId }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ exists: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App makeProvider={() => new NullProvider()} />);
    fireEvent.click(screen.getByTestId('create-board'));
    await flush();

    // The address bar shows the new board, which is the address the panel will
    // offer, which is the address a second visitor has to be given.
    expect(window.location.pathname).toBe(`/b/${boardId}`);
    expect(screen.getByTestId('viewport')).toBeTruthy();
    // One request for the board, one to check the link the visitor now lives at.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      '/api/boards',
      `/api/boards/${boardId}`,
    ]);
  });
});
