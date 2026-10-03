// persist.client_status — the load-failure badge, the edit lock and the close-code
// mapping (TC-22, TC-23, TC-28). A board the room could not load is the one
// connection state that is NOT merely informational: it must show an honest red
// message and stop every edit, while a retryable close (1011 / 1003) must stay
// amber and leave the board editable. These tests drive the real App tree against
// the component stub of y-websocket, which emits the same `connection-close`
// payload the transport does.

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  canEdit,
  createConnectionTracker,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { snapshot } from '../../src/shared/board-model';
import {
  boardDoc,
  createNote,
  doubleClick,
  noteCount,
  noteEl,
  pointer,
  surface,
  windowKey,
} from './helpers';
import {
  lastProvider,
  resetProviderStub,
  type WebsocketProvider,
} from './y-websocket-stub';

/** The live board as a snapshot, sorted by id, for "did anything change?" checks. */
function model() {
  return snapshot(boardDoc());
}

/** The provider instance the currently-rendered <App/> created. */
function provider(): WebsocketProvider {
  const p = lastProvider();
  if (!p) throw new Error('no provider (render <App/> first)');
  return p;
}

/** Drive the App's real connection into `load_failed` via the close-code path. */
function forceLoadFailed(): void {
  act(() => provider().emitClose(CLOSE_BOARD_LOAD_FAILED));
}

/**
 * The connection badge, or null while it is hidden. Addressed by test id, not
 * role: the board also shows a NavigationHint with role=status, so a role query
 * would match two elements once <App/> is rendered.
 */
function badge(): HTMLElement | null {
  return screen.queryByTestId('connection-status');
}

describe('persist.client_status', () => {
  beforeEach(() => {
    resetProviderStub();
  });

  it('TC-22 renders a red load-failure badge with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);

    const badge = screen.getByRole('status');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("This board couldn't be loaded. Retrying…");
    // "Red" is expressed by its own state class (colour is pure CSS); the badge is
    // a live region so it is announced.
    expect(badge.getAttribute('data-state')).toBe('load_failed');
    expect(badge.className).toContain('connection-status--load_failed');
    expect(badge.getAttribute('role')).toBe('status');
  });

  it('TC-23 locks every board mutation while the board could not be loaded', () => {
    render(<App />);
    const id = createNote(300, 300);
    // Take the connection through a normal sync, then a load failure.
    act(() => provider().emitSync(true));
    forceLoadFailed();
    expect(badge()?.textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );

    const before = JSON.stringify(model());

    // The Sticky note button is disabled and creates nothing.
    const create = screen.getByTestId('create-sticky') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(noteCount()).toBe(1);

    // Double-clicking empty board creates nothing.
    doubleClick(surface(), 640, 400);
    expect(noteCount()).toBe(1);

    // Double-clicking the note does not open it for editing.
    doubleClick(noteEl(id), 0, 0);
    expect(noteEl(id).querySelector('textarea')).toBeNull();

    // A drag moves nothing.
    pointer(noteEl(id), 'pointerdown', 10, 10);
    pointer(noteEl(id), 'pointermove', 300, 300);
    pointer(noteEl(id), 'pointerup', 300, 300);

    // A selected note survives Delete/Backspace.
    windowKey('Delete');
    windowKey('Backspace');

    // Nothing at all changed in the model.
    expect(JSON.stringify(model())).toBe(before);
  });

  it('TC-28 maps close codes: 4500 locks, 1011 / 1003 stay reconnecting and editable', () => {
    render(<App />);
    const id = createNote(200, 200);
    act(() => provider().emitSync(true));
    const create = () =>
      screen.getByTestId('create-sticky') as HTMLButtonElement;

    // A retryable storage failure (1011) is NOT "couldn't be loaded": the board is
    // readable and unsaved changes are re-sent on reconnect, so it stays editable.
    act(() => provider().emitClose(CLOSE_STORAGE_FAILURE));
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
    expect(create().disabled).toBe(false);

    // An unsupported-data close (1003) is the same: reconnecting, still editable.
    act(() => provider().emitClose(CLOSE_UNSUPPORTED_DATA));
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
    expect(create().disabled).toBe(false);

    // The load-failure code (4500) is the only one that reads as an unloadable board.
    act(() => provider().emitClose(CLOSE_BOARD_LOAD_FAILED));
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');
    expect(create().disabled).toBe(true);

    // Recovery without a reload: the provider retries, a sync lands, and editing
    // comes back on its own.
    act(() => {
      provider().emitStatus('connected');
      provider().emitSync(true);
    });
    expect(badge()).toBeNull();
    expect(create().disabled).toBe(false);
    // And it really can edit again: the button now creates a second note.
    fireEvent.click(create());
    expect(noteCount()).toBe(2);
    expect(model().some((n) => n.id === id)).toBe(true);
  });

  it('canEdit is false only for load_failed', () => {
    const locked: ConnectionState[] = ['load_failed'];
    const open: ConnectionState[] = [
      'connecting',
      'connected',
      'reconnecting',
      'confirmed',
    ];
    for (const state of locked) expect(canEdit(state)).toBe(false);
    for (const state of open) expect(canEdit(state)).toBe(true);
  });

  it('the tracker holds load_failed across retries and recovers on a sync', () => {
    const seen: ConnectionState[] = [];
    const tracker = createConnectionTracker((s) => seen.push(s));

    // Established connection.
    tracker.sync(true);
    expect(tracker.state).toBe('connected');

    // 4500 → load_failed, and it does NOT flicker to "Reconnecting…" as the
    // provider patiently retries in the background.
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    expect(tracker.state).toBe('load_failed');
    tracker.status('disconnected');
    tracker.status('connecting');
    tracker.close(CLOSE_BOARD_LOAD_FAILED);
    expect(tracker.state).toBe('load_failed');

    // A retry that finally loads: the sync clears the failure and editing returns.
    tracker.status('connected');
    tracker.sync(true);
    expect(tracker.state).toBe('connected');
    expect(seen).toEqual(['connected', 'load_failed', 'connected']);
  });
});
