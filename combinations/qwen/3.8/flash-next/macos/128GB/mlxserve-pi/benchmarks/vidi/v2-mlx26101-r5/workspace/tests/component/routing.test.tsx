/**
 * TC-32, TC-33, TC-34: the address bar chooses the board.
 *
 * `App` is rendered at an address and the board that comes out is checked against it.
 * The socket is a fake that never leaves the ground — which is what makes the part of
 * TC-34 that matters testable at all: a link that is not a board must not reach out to
 * a room, and the only way to know that is to be able to count the sockets.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/client/App';
import { INVALID_BOARD_MESSAGE } from '../../src/client/board/InvalidBoard';
import { boardPath } from '../../src/client/board/useBoardRoute';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** A WebSocket that exists to be counted, and never connects anywhere. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeSocket.CONNECTING;
  closedWith: number | null = null;
  readonly sent: unknown[] = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket {
    const latest = FakeSocket.instances.at(-1);
    if (latest === undefined) throw new Error('no socket was opened');
    return latest;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1005;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code: this.closedWith });
  }

  /** The room answers: the socket is up. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.({});
  }
}

/** Puts the page at an address before the app reads it. */
function goTo(pathname: string): void {
  window.history.replaceState({}, '', pathname);
}

/** The board id in the address, or null if there is not one. */
function boardIdInAddress(): string | null {
  const pathname = window.location.pathname;
  if (!pathname.startsWith('/b/')) return null;
  const id = pathname.slice('/b/'.length);
  return id === '' ? null : id;
}

function address(): string {
  return window.location.pathname;
}

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal('WebSocket', FakeSocket);
  window.sessionStorage.clear();
  goTo('/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  goTo('/');
});

describe('TC-32 — arriving at /', () => {
  it('is given a board rather than an empty screen', () => {
    goTo('/');
    render(<App />);
    expect(screen.getByTestId('app')).toBeDefined();
    const boardId = boardIdInAddress();
    expect(boardId).not.toBeNull();
    expect(isValidBoardId(boardId as string)).toBe(true);
  });

  it('puts the board it chose in the address bar', () => {
    goTo('/');
    const { container } = render(<App />);
    const boardId = boardIdInAddress() as string;
    // The board on screen is the board the address names, and the room it reached for is
    // that board's room — one id, three places, no room for them to disagree.
    const socket = FakeSocket.last;
    expect(socket.url).toContain(`/api/rooms/${boardId}`);
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
  });

  it('keeps the same board when it re-renders', () => {
    goTo('/');
    const { rerender } = render(<App />);
    const boardId = boardIdInAddress();
    const sockets = FakeSocket.instances.length;
    rerender(<App />);
    rerender(<App />);
    expect(boardIdInAddress()).toBe(boardId);
    expect(FakeSocket.instances).toHaveLength(sockets);
  });

  it('takes a visitor at /b/ to a board as well', () => {
    goTo('/b/');
    render(<App />);
    expect(isValidBoardId(boardIdInAddress() as string)).toBe(true);
    expect(screen.getByTestId('app')).toBeDefined();
  });

  it('treats an address nobody gave a meaning as a request for a board', () => {
    goTo('/pricing');
    render(<App />);
    expect(screen.getByTestId('app')).toBeDefined();
    expect(isValidBoardId(boardIdInAddress() as string)).toBe(true);
  });
});

describe('TC-33 — arriving at a board link', () => {
  it('shows the board named in the address', () => {
    const boardId = newBoardId();
    goTo(boardPath(boardId));
    render(<App />);
    expect(screen.getByTestId('app')).toBeDefined();
    expect(address()).toBe(boardPath(boardId));
  });

  it('shows Connecting… while the room is still being reached', () => {
    goTo(boardPath(newBoardId()));
    render(<App />);
    const badge = screen.getByTestId('connection-status');
    expect(badge.textContent).toBe('Connecting…');
    expect(badge.getAttribute('role')).toBe('status');
  });

  it('asks for that board’s room, not for some other one', () => {
    const mine = newBoardId();
    const other = newBoardId();
    goTo(boardPath(mine));
    render(<App />);
    const socket = FakeSocket.last;
    expect(socket.url).toContain(`/api/rooms/${mine}`);
    expect(socket.url).not.toContain(`/api/rooms/${other}`);
    // y-websocket adds its own ?room= parameter; the path is what the Worker routes on,
    // so the path must carry this board and only this board.
    expect(new URL(socket.url).pathname).toBe(`/api/rooms/${mine}`);
  });

  it('leaves the address alone when it already names a board', () => {
    const boardId = newBoardId();
    goTo(boardPath(boardId));
    render(<App />);
    expect(address()).toBe(boardPath(boardId));
  });

  it('hides the badge once the room answers', () => {
    goTo(boardPath(newBoardId()));
    render(<App />);
    act(() => {
      FakeSocket.last.open();
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });

  it('accepts an id made of every character a board id may use', () => {
    // Twenty-two characters from the alphabet board ids are drawn from, dash included.
    const boardId = 'abcdefghij-klmnopqrst0';
    goTo(boardPath(boardId));
    render(<App />);
    expect(isValidBoardId(boardId)).toBe(true);
    expect(screen.getByTestId('app')).toBeDefined();
    expect(FakeSocket.last.url).toContain(`/api/rooms/${boardId}`);
  });
});

describe('TC-34 — arriving at a link that is not a board', () => {
  it('says so, in words, instead of opening a board', () => {
    goTo('/b/nope');
    render(<App />);
    expect(screen.getByTestId('app-invalid')).toBeDefined();
    expect(screen.getByText(INVALID_BOARD_MESSAGE)).toBeDefined();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('shows what it did not understand, so the link can be checked', () => {
    goTo('/b/nope');
    render(<App />);
    expect(screen.getByTestId('invalid-board-id').textContent).toBe('nope');
  });

  it('does not reach out to a room for it', () => {
    // The point of counting sockets: a board that does not exist must not be joined, and
    // a link somebody typed must not become somebody else's board.
    goTo('/b/nope');
    render(<App />);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('keeps the address as it was given', () => {
    goTo('/b/nope');
    render(<App />);
    expect(address()).toBe('/b/nope');
  });

  it('rejects ids too short and too long alike', () => {
    for (const bad of ['short', `${newBoardId()}x`, 'has spaces', 'with.dots', 'UPPER_lower_012'.repeat(3)]) {
      FakeSocket.reset();
      goTo(boardPath(bad));
      const { unmount } = render(<App />);
      expect(screen.getByTestId('app-invalid')).toBeDefined();
      expect(FakeSocket.instances).toHaveLength(0);
      unmount();
    }
  });

  it('gives a working way out, which opens a board of its own', () => {
    goTo('/b/nope');
    render(<App />);
    const button = screen.getByTestId('new-board-button');
    fireEvent.click(button);

    // A board now, on an address that names it, reached over a socket for that board.
    expect(screen.getByTestId('app')).toBeDefined();
    expect(screen.queryByTestId('app-invalid')).toBeNull();
    const boardId = boardIdInAddress();
    expect(isValidBoardId(boardId as string)).toBe(true);
    expect(FakeSocket.last.url).toContain(`/api/rooms/${boardId as string}`);
  });

  it('does not stay stuck after the way out is taken', () => {
    goTo('/b/nope');
    render(<App />);
    fireEvent.click(screen.getByTestId('new-board-button'));
    act(() => {
      FakeSocket.last.open();
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();
  });
});

describe('moving between boards', () => {
  it('opens the new board’s room and closes the door on the old one', () => {
    const first = newBoardId();
    const second = newBoardId();
    goTo(boardPath(first));
    render(<App />);
    const firstSocket = FakeSocket.last;
    firstSocket.open();

    act(() => {
      window.history.pushState({}, '', boardPath(second));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const latest = FakeSocket.last;
    expect(latest.url).toContain(`/api/rooms/${second}`);
    expect(latest).not.toBe(firstSocket);
    // The old board is gone from the screen: not its notes, not its connection.
    expect(address()).toBe(boardPath(second));
  });

  it('keeps the identity through a move, because it is the same person', () => {
    goTo(boardPath(newBoardId()));
    render(<App />);
    const before = window.sessionStorage.length;
    act(() => {
      window.history.pushState({}, '', boardPath(newBoardId()));
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(window.sessionStorage.length).toBe(before);
  });
});
