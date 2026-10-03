import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { App } from '../../src/client/App';
import { BoardPage } from '../../src/client/pages/BoardPage';
import * as api from '../../src/client/api';
import { newBoardId } from '../../src/shared/board-id';

// Mock the network + API layers (per-test implementations below).
vi.mock('../../src/client/api', () => ({
  checkBoard: vi.fn(),
  createBoardRequest: vi.fn(),
}));

vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: vi.fn(() => ({ destroy: () => {} })),
}));

// BoardViewport uses ResizeObserver; jsdom has none.
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(_el: Element) {
    this.callback([{ contentRect: { width: 1280, height: 800 } }] as any, this as any);
  }
  disconnect() {}
  unobserve() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

const checkBoard = api.checkBoard as unknown as ReturnType<typeof vi.fn>;
const createBoardRequest = api.createBoardRequest as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
});

describe('pages: Home', () => {
  it('shows the product name, a description, and a New board button', () => {
    render(<App />);
    expect(screen.getByTestId('home-page')).toBeTruthy();
    expect(screen.getByText('vidi6')).toBeTruthy();
    const btn = screen.getByTestId('new-board-button');
    expect(btn.textContent).toBe('New board');
  });

  it('clicking New board creates a board and navigates to /b/<id>', async () => {
    const id = newBoardId();
    createBoardRequest.mockResolvedValue({ kind: 'created', id });
    render(<App />);

    fireEvent.click(screen.getByTestId('new-board-button'));

    expect(createBoardRequest).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe(`/b/${id}`);
    });
  });

  it('shows an error and stays on home when creation fails', async () => {
    createBoardRequest.mockRejectedValue(new Error('boom'));
    render(<App />);

    fireEvent.click(screen.getByTestId('new-board-button'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('create-error')).toBeTruthy();
    });
    // Still on home (no navigation).
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('home-page')).toBeTruthy();
  });
});

describe('pages: Board not found', () => {
  it('shows a clear message, a New board offer, and a link home for an unknown id', async () => {
    checkBoard.mockResolvedValue({ kind: 'not_found' });
    window.history.pushState({}, '', `/b/${newBoardId()}`);
    render(<App />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeTruthy();
    });
    expect(screen.getByText('Board not found')).toBeTruthy();
    expect(screen.getByTestId('new-board-button')).toBeTruthy();
    expect(screen.getByText('Back to home')).toBeTruthy();
  });
});

describe('pages: Board states', () => {
  it('shows "Opening board…" while the existence check is pending', () => {
    // Never resolves → stays in the checking state.
    checkBoard.mockReturnValue(new Promise(() => {}));
    const id = newBoardId();
    window.history.pushState({}, '', `/b/${id}`);
    render(<BoardPage id={id} />);
    expect(screen.getByTestId('board-checking')).toBeTruthy();
    expect(screen.getByText('Opening board…')).toBeTruthy();
  });

  it('shows "Couldn\'t reach vidi6. Retrying…" when the server is unreachable', async () => {
    checkBoard.mockResolvedValue({ kind: 'unreachable' });
    const id = newBoardId();
    window.history.pushState({}, '', `/b/${id}`);
    render(<BoardPage id={id} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('board-unreachable')).toBeTruthy();
    });
    expect(screen.getByText("Couldn't reach vidi6. Retrying…")).toBeTruthy();
  });

  it('mounts the board (full editing) once the check confirms the board exists', async () => {
    checkBoard.mockResolvedValue({ kind: 'exists' });
    const id = newBoardId();
    window.history.pushState({}, '', `/b/${id}`);
    render(<BoardPage id={id} />);

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="board-viewport"]')).not.toBeNull();
    });
    expect(document.querySelector('[data-testid="toolbar"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="share-button"]')).not.toBeNull();
  });

  it('does not send an existence request for a malformed id (renders not found directly)', () => {
    const bad = 'a'.repeat(21);
    window.history.pushState({}, '', `/b/${bad}`);
    render(<BoardPage id={bad} />);
    expect(screen.getByTestId('not-found-page')).toBeTruthy();
    expect(checkBoard).not.toHaveBeenCalled();
  });
});
