/**
 * Load-failure badge and edit lock (persist.client_status, TC-22, TC-23, close-code mapping).
 * "No model mutation" is observed as zero updates on the board's real Y.Doc: every
 * board-model mutation (create, move, bring to front, text, colour, delete) produces one.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App, canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { click, countUpdates, editor, noteEl, pointer, viewportEl } from './boardHelpers';
import { fakeProviders } from './fakeProvider';
import { flushFrame } from './helpers';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
const START = { x: 300, y: 200 };
const fakes = fakeProviders();
const provider = () => fakes.provider();

function badge(): HTMLElement | null {
  return screen.queryByTestId('connection-status');
}

function stickyButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Sticky note' });
}

/** A live board whose doc already shows one note (e.g. from an earlier session in this tab). */
function renderLiveBoard() {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  getStickyText(doc, id)?.insert(0, 'Keep me');
  render(<App boardId={newBoardId()} doc={doc} createProvider={fakes.createProvider} />);
  return { doc, id };
}

beforeEach(() => {
  fakes.reset();
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionStatus load_failed (persist.client_status)', () => {
  it('TC-22 renders the red load-failure message with role status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = badge();
    expect(el).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(el).toHaveAttribute('role', 'status');
    expect(el).toHaveAttribute('data-state', 'load_failed');
  });

  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(states.filter((s) => !canEdit(s))).toEqual(['load_failed']);
  });
});

describe('Close-code mapping (persist.client_status)', () => {
  it(`${CLOSE_BOARD_LOAD_FAILED} on first open → load_failed, retries keep it, a sync recovers and unlocks`, () => {
    const { doc } = renderLiveBoard();
    expect(badge()).toHaveTextContent('Connecting…');
    provider().refuse(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(stickyButton()).toBeDisabled();

    provider().refuse(CLOSE_BOARD_LOAD_FAILED); // retry refused again
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    provider().status('connecting');
    provider().drop(1006); // retry without reaching the server: the board is still not loaded
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);

    provider().open(); // load succeeds on a later retry, without a page reload
    expect(badge()).toBeNull();
    expect(stickyButton()).toBeEnabled();
    fireEvent.click(stickyButton());
    expect(snapshot(doc)).toHaveLength(2);
  });

  it(`${CLOSE_BOARD_LOAD_FAILED} after a board was open also locks it`, () => {
    renderLiveBoard();
    provider().open();
    provider().drop(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(stickyButton()).toBeDisabled();
  });

  it(`${CLOSE_STORAGE_FAILURE} (storage failure) is an ordinary reconnection and stays editable`, () => {
    const { doc } = renderLiveBoard();
    provider().open();
    provider().drop(CLOSE_STORAGE_FAILURE);
    expect(badge()).toHaveTextContent('Reconnecting…');
    expect(badge()).toHaveAttribute('data-state', 'reconnecting');
    expect(stickyButton()).toBeEnabled();
    fireEvent.click(stickyButton());
    expect(snapshot(doc)).toHaveLength(2);
    provider().open();
    expect(badge()).toHaveTextContent('Connected');
  });
});

describe('Edit lock while load_failed (persist.client_status)', () => {
  it('TC-23 no gesture changes the board', () => {
    const { doc, id } = renderLiveBoard();
    provider().refuse(CLOSE_BOARD_LOAD_FAILED);
    const updates = countUpdates(doc);

    // Create by double-click and by the (disabled) Sticky note button.
    fireEvent.doubleClick(viewportEl(), { clientX: 700, clientY: 500 });
    expect(stickyButton()).toBeDisabled();
    fireEvent.click(stickyButton());

    // Drag the note.
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + DRAG_THRESHOLD_PX + 40, y: START.y + 30 });
    flushFrame();
    pointer(el, 'pointerUp', { x: START.x + DRAG_THRESHOLD_PX + 40, y: START.y + 30 });
    flushFrame();

    // Select it, then Delete / Backspace / Enter.
    click(noteEl(id), START);
    for (const key of ['Delete', 'Backspace', 'Enter']) fireEvent.keyDown(noteEl(id), { key });

    // Type in it: double-click opens no editor.
    fireEvent.doubleClick(noteEl(id));
    expect(editor()).toBeNull();

    // Colour and delete controls are not offered.
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();

    act(() => vi.advanceTimersByTime(1000));
    expect(updates.count).toBe(0);
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0]).toMatchObject({ id, text: 'Keep me' });
  });

  it('an open editor closes when the board becomes load_failed', () => {
    const { doc, id } = renderLiveBoard();
    provider().open();
    fireEvent.doubleClick(noteEl(id));
    expect(editor()).not.toBeNull();
    provider().drop(CLOSE_BOARD_LOAD_FAILED);
    expect(editor()).toBeNull();
    expect(snapshot(doc)[0]?.text).toBe('Keep me');
  });
});
