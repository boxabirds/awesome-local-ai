import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { createSticky } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { newBoardId } from '../../src/shared/board-id';
import type { ConnectOptions } from '../../src/client/sync/connectBoard';
import { FakeClock, FakeProvider } from './fake-sync';

/**
 * Story 4 — the load-failure badge and edit lock (TC-22, TC-23, TC-28).
 *
 * The client learns a board could not be loaded from one thing: the room closed the
 * socket with `CLOSE_BOARD_LOAD_FAILED` (4500). A fake provider emits the same
 * `connection-close` event `y-websocket` does, so the close-code mapping — 4500 to
 * "couldn't be loaded" and every other code to a plain reconnect — is driven here
 * rather than over a real socket (design "Fixtures").
 */
function renderBoard(): { provider: FakeProvider; clock: FakeClock } {
  const provider = new FakeProvider();
  const clock = new FakeClock();
  const connect: ConnectOptions = { after: clock.after };
  render(<Board boardId={newBoardId()} sync connect={connect} provider={provider} />);
  return { provider, clock };
}

function goToConnected(provider: FakeProvider): void {
  act(() => {
    provider.emitStatus('connecting');
    provider.emitStatus('connected');
    provider.emitSync(true);
  });
  expect(screen.queryByTestId('connection-status')).toBeNull();
}

function badge(): { text: string; state: string; className: string } | null {
  const el = screen.queryByTestId('connection-status');
  if (!el) return null;
  return {
    text: el.textContent ?? '',
    state: el.getAttribute('data-state') ?? '',
    className: el.className,
  };
}

const createButton = () => screen.getByTestId('create-sticky') as HTMLButtonElement;

// =========================================================== TC-22
describe('a board that failed to load says so in red (TC-22)', () => {
  it('renders the load-failure message as a red status live region', () => {
    const { provider } = renderBoard();
    goToConnected(provider);

    // The room refused to serve the saved board and closed with 4500.
    act(() => provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED));

    const el = screen.getByTestId('connection-status');
    expect(el.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(el.getAttribute('data-state')).toBe('load_failed');
    // The message is red (the load_failed modifier is styled red) and announced politely.
    expect(el.className).toContain('connection-status--load_failed');
    expect(el.getAttribute('data-red')).toBe('true');
    expect(el.getAttribute('role')).toBe('status');
  });

  it('stays up across retries, and clears only when the board finally loads', () => {
    const { provider } = renderBoard();
    goToConnected(provider);

    act(() => provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED));
    expect(badge()?.state).toBe('load_failed');

    // A retry that is refused again keeps the same message (LoadFailed -> LoadFailed).
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
    });
    expect(badge()?.state).toBe('load_failed');

    // When a retry finally loads and syncs, the load-failure message is gone and the
    // board is live: a re-sync confirms it (the message no longer says "couldn't load").
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(badge()?.state).toBe('confirmed');
  });
});

// =========================================================== TC-23
describe('a board that failed to load cannot be edited (TC-23)', () => {
  type Note = { id: string; x: number; y: number };
  const hook = () =>
    (window as unknown as { __vidi6: { getDoc(): Y.Doc; getSnapshot(): readonly Note[] } }).__vidi6;

  it('locks every edit path while the load-failure message is up', () => {
    const { provider } = renderBoard();
    goToConnected(provider);

    // A plain (not editing, not selected) note exists while the board is editable.
    act(() => createSticky(hook().getDoc(), { x: 50, y: 50 }));
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);
    const before = hook().getSnapshot();
    expect(before).toHaveLength(1);

    // Then the board refuses to (re)load: every edit path is now inert.
    act(() => provider.emitConnectionClose(CLOSE_BOARD_LOAD_FAILED));
    expect(badge()?.state).toBe('load_failed');
    expect(createButton().disabled).toBe(true);

    // 1. Double-click the board: creates nothing.
    fireEvent.dblClick(screen.getByTestId('board-viewport'), { clientX: 400, clientY: 300 });
    expect(hook().getSnapshot()).toHaveLength(1);

    // 2. Click the (disabled) Sticky note button: creates nothing.
    fireEvent.click(createButton());
    expect(hook().getSnapshot()).toHaveLength(1);

    // 3. Press Delete (with no selection, which is all a locked board allows): removes
    //    nothing, because there is nothing selected to delete.
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(hook().getSnapshot()).toHaveLength(1);

    // 4. Drag the existing note: it does not move (moveObject never runs).
    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    expect(hook().getSnapshot()[0]?.x).toBe(before[0]?.x);

    // 5. Double-click the note: it does not open for editing, so nothing is typed.
    fireEvent.dblClick(screen.getByTestId('sticky-note'));
    expect(screen.getByTestId('sticky-note').getAttribute('data-editing')).toBe('false');

    expect(hook().getSnapshot()).toHaveLength(1); // the board is exactly as it was
  });
});

// =========================================================== TC-28
describe('close codes other than 4500 are a plain reconnect (TC-28)', () => {
  it('1011 then 1003 leave the board reconnecting and editable, never load_failed', () => {
    const { provider } = renderBoard();
    goToConnected(provider);

    // A storage failure (1011): the board is readable, so it is "Reconnecting…" and
    // still editable — never "couldn't be loaded".
    act(() => provider.emitConnectionClose(CLOSE_STORAGE_FAILURE));
    expect(badge()).toEqual({
      text: 'Reconnecting…',
      state: 'reconnecting',
      className: expect.any(String),
    });
    expect(createButton().disabled).toBe(false);
    fireEvent.click(createButton());
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);

    // A rejected-data close (1003) after a re-sync is the same: reconnecting, not a
    // load failure. Re-syncing first brings the green confirmation back; 1003 replaces
    // it with "Reconnecting…" and cancels its timer.
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(badge()?.state).toBe('confirmed');
    act(() => provider.emitConnectionClose(CLOSE_UNSUPPORTED_DATA));
    expect(badge()?.state).toBe('reconnecting');
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1); // nothing was lost
    expect(createButton().disabled).toBe(false);
  });
});
