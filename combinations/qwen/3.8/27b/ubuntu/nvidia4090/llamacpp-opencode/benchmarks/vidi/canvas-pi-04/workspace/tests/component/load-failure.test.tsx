// Story 4, task 8: load-failure component tests (TC-22, TC-23).
//
// TC-22: the badge renders the red load_failed message with role="status",
// and the state machine maps a 4500 close to load_failed (and a later
// successful re-sync back to connected).
//
// TC-23: the App in the load_failed state accepts no edits — double-click
// create, the Sticky note button and Delete are all no-ops (the board is
// read-only while it could not be loaded).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  observeConnectionStatus,
  type ConnectionState,
  type ConnectionStatusObserver,
} from '../../src/client/sync/connectBoard';
import { resetBoardForTests } from '../../src/client/canvas/useCamera';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { newBoardId } from '../../src/shared/board-id';
import { createStickyAt, snapshot } from '../../src/shared/board-model';

/**
 * Mock the client connector: report the board as load_failed immediately and
 * seed one sticky into the doc so "delete a note" has a target. The real
 * exports (canEdit, observeConnectionStatus, …) are kept.
 */
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  const boardModel = await import('../../src/shared/board-model');
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState('load_failed');
      // Seed AFTER the current effect commit: useBoardDoc attaches its
      // observeDeep store subscription in the same commit, and the snapshot
      // cache is only invalidated by that handler. A microtask lands after
      // the subscription is live, so the seeded note triggers a real store
      // change and re-render (the synchronous path would be served from the
      // stale empty cache).
      queueMicrotask(() => {
        if (boardModel.snapshot(doc).length === 0) {
          boardModel.createStickyAt(doc, 120, 80, 'yellow');
        }
      });
      return { destroy: (): void => undefined };
    },
  };
});

// ---- the badge + state machine (TC-22) -----------------------------------

function fakeProvider(onState: (state: ConnectionState) => void): {
  status(status: 'connecting' | 'connected' | 'disconnected'): void;
  sync(synced: boolean): void;
  close(code: number): void;
  destroy(): void;
} {
  const observer: ConnectionStatusObserver = observeConnectionStatus(onState);
  return {
    status: (status) => act(() => observer.onStatus({ status })),
    sync: (synced) => act(() => observer.onSync([synced])),
    close: (code) => act(() => observer.onConnectionClose({ code })),
    destroy: () => observer.destroy(),
  };
}

/** Capture the rendered board state straight from the DOM (no doc access). */
function boardState(): Array<{
  id: string | null;
  left: string;
  top: string;
  color: string | null;
  text: string;
}> {
  return screen
    .getAllByRole('group', { name: 'Sticky note' })
    .map((el) => ({
      id: el.getAttribute('data-note-id'),
      left: el.style.left,
      top: el.style.top,
      color: el.getAttribute('data-color'),
      text: el.textContent ?? '',
    }));
}

describe('load failure (task 8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // Reset the route for the next test.
    window.history.pushState({}, '', '/');
  });

  it('TC-22: the load_failed badge is red text with role="status"', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(badge.getAttribute('data-state')).toBe('load_failed');
  });

  it('TC-22: close 4500 → load_failed; a later successful sync → connected', () => {
    const onState = vi.fn<(state: ConnectionState) => void>();
    const provider = fakeProvider(onState);

    expect(onState).toHaveBeenLastCalledWith('connecting');
    provider.status('connected');
    provider.sync(true);
    expect(onState).toHaveBeenLastCalledWith('connected');

    // The room could not load the board: it closes us with 4500.
    provider.close(CLOSE_BOARD_LOAD_FAILED);
    expect(onState).toHaveBeenLastCalledWith('load_failed');

    // The provider retries and syncs: the board is live and editable again.
    provider.sync(true);
    expect(onState).toHaveBeenLastCalledWith('connected');
    provider.destroy();
  });

  it('TC-23: App in load_failed — create, button and Delete are no-ops', async () => {
    window.history.pushState({}, '', `/b/${newBoardId()}`);

    render(<App />);
    // Flush the seeded microtask (and the store re-render it triggers).
    await act(async () => undefined);

    // The seeded note renders; the board is in the load_failed state.
    const note = screen.getByRole('group', { name: 'Sticky note' });
    // The badge is queried by text: <output> has an implicit role="status",
    // so a generic getByRole('status') would also match the zoom label.
    const badge = screen.getByText("This board couldn't be loaded. Retrying…");
    expect(badge.getAttribute('data-state')).toBe('load_failed');

    const before = boardState();
    expect(before).toHaveLength(1);

    // (a) Double-click on empty board space: no note is created.
    fireEvent.doubleClick(screen.getByTestId('board-viewport'));
    expect(boardState()).toEqual(before);

    // (b) The Sticky note button is disabled while load_failed.
    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(boardState()).toEqual(before);

    // (c) Select the note, then press Delete: the note is not removed.
    fireEvent.pointerDown(note, { button: 0, pointerType: 'mouse' });
    expect(note.getAttribute('data-selected')).toBe('');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(boardState()).toEqual(before);

    // The note is still there, unchanged.
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeTruthy();
  });
});
