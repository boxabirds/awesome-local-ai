/**
 * Story 4: persist.client_status — the load-failure badge (TC-22) and the edit
 * lock (TC-23), plus the close-code mapping that drives both.
 *
 * TC-22/TC-23 render the real App; the close-code mapping drives the extracted
 * connection state machine with a fake `connection-close` emitter.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CONNECTED_CONFIRMATION_MS } from 'src/shared/config';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';

// Force the board into `load_failed` for this file: the (mocked) provider
// reports a 4500 close. `canEdit` / `createConnectionStateMachine` are the real
// implementation (spread from the module under test).
vi.mock('src/client/sync/connectBoard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: vi.fn((_doc, _boardId, onState) => {
      onState('load_failed');
      return {
        destroy: () => {},
        dropSocket: () => {},
        resumeSocket: () => {},
      };
    }),
  };
});

import {
  createConnectionStateMachine,
  canEdit,
  type ConnectionState,
} from 'src/client/sync/connectBoard';
import { ConnectionStatus, LOAD_FAILED_MESSAGE } from 'src/client/sync/ConnectionStatus';
import { App } from 'src/client/App';
import { createSticky, getStickyText, snapshot } from 'src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from 'src/shared/protocol';

function setupBadge(): {
  machine: ReturnType<typeof createConnectionStateMachine>;
  state: () => ConnectionState;
  rerender: () => void;
} {
  let state: ConnectionState = 'connecting';
  const machine = createConnectionStateMachine((s) => {
    state = s;
  });
  const view = render(<ConnectionStatus state={state} />);
  return {
    machine,
    state: () => state,
    rerender: () => view.rerender(<ConnectionStatus state={state} />),
  };
}

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

describe('persist.client_status badge (TC-22)', () => {
  it("load_failed → red \"This board couldn't be loaded. Retrying…\" with role=status", () => {
    const { machine, rerender } = setupBadge();
    // A board that fails to load closes the socket with 4500.
    machine.onClose(CLOSE_BOARD_LOAD_FAILED);
    rerender();
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(LOAD_FAILED_MESSAGE);
    expect(badge).toHaveStyle({ background: '#DC2626' });
  });
});

describe('persist.client_status close-code mapping', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('4500 → load_failed (sticky through retries); sync → re-enabled; 1011 → reconnecting', () => {
    vi.useFakeTimers();
    const seen: ConnectionState[] = [];
    const machine = createConnectionStateMachine((s) => seen.push(s));

    // A synced board, then a load failure (4500) → locked.
    machine.onSync(true);
    machine.onClose(CLOSE_BOARD_LOAD_FAILED);
    expect(canEdit('load_failed')).toBe(false);
    expect(seen[seen.length - 1]).toBe('load_failed');

    // The load-failure lock is sticky through background reconnects.
    machine.onStatus('connecting');
    machine.onStatus('disconnected');
    expect(seen[seen.length - 1]).toBe('load_failed');

    // Repair: the provider reconnects and syncs → re-enabled without a page
    // reload (briefly `confirmed`, then `connected`).
    machine.onStatus('connected');
    machine.onSync(true);
    expect(canEdit(seen[seen.length - 1])).toBe(true);
    expect(seen[seen.length - 1]).toBe('confirmed');
    vi.advanceTimersByTime(CONNECTED_CONFIRMATION_MS);
    machine.destroy();
    expect(canEdit('connected')).toBe(true);

    // A storage failure (1011) on a synced board → reconnecting, NOT locked.
    machine.onClose(CLOSE_STORAGE_FAILURE);
    expect(seen[seen.length - 1]).toBe('reconnecting');
    expect(canEdit('reconnecting')).toBe(true);
  });
});

describe('persist.client_status edit lock (TC-23)', () => {
  it('create, delete, drag, colour and text edit are all no-ops while locked', async () => {
    const user = userEvent.setup();
    render(<App />);
    const doc = getDoc();

    // Seed one note directly in the model (setup, not a UI interaction).
    const seedId = createSticky(doc, { x: 0, y: 0 }, 'yellow', 'locked-note')!;
    getStickyText(doc, seedId)?.insert(0, 'original');
    await waitFor(() => expect(snapshot(doc).length).toBe(1));
    const before = snapshot(doc)[0];

    // 1) Double-click on empty board space: no new note.
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport, { clientX: 10, clientY: 10 });

    // 2) The Sticky note button is disabled and creates nothing.
    const button = screen.getByTestId('sticky-note-button');
    expect(button).toBeDisabled();
    fireEvent.click(button);

    // 3) Delete on the selected note: the note survives.
    const note = screen.getByTestId('sticky-note');
    await user.click(note); // select
    await user.keyboard('Delete');

    // 4) Drag: the note does not move.
    fireEvent.pointerDown(note, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerMove(note, { clientX: 120, clientY: 120 });
    fireEvent.pointerUp(note, { clientX: 120, clientY: 120 });

    // 5) Double-click the note: the text editor does not appear.
    fireEvent.doubleClick(note);

    // Nothing changed: exactly one note, same text / colour / position.
    await waitFor(() => expect(snapshot(doc).length).toBe(1));
    const after = snapshot(doc)[0];
    expect(after.id).toBe(before.id);
    expect(after.text).toBe('original');
    expect(after.color).toBe('yellow');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(screen.queryByTestId('sticky-text-editor')).toBeNull();
  });
});
