/**
 * persist.client_status component tests (TC-22, TC-23, TC-28):
 * - TC-22 the `load_failed` badge is red with the honest message (role=status).
 * - TC-23 the App in `load_failed` performs zero board-model mutations for
 *   create (dblclick + button), delete, drag and text edit (negative).
 * - TC-28 the close-code mapping: 4500 → load_failed, 1011/1003 →
 *   reconnecting (editing stays enabled), and a later sync recovers to
 *   connected with editing re-enabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createConnectionController,
  canEdit,
  type ConnectionState,
  type ConnectionController,
} from '../../src/client/sync/connectBoard';
import * as boardModel from '../../src/shared/board-model';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

describe('persist.client_status', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('TC-22: load_failed → red "This board couldn\'t be loaded. Retrying…" with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(LOAD_FAILED_TEXT);
    // Red background (the "couldn't be loaded" colour, distinct from amber).
    expect(getComputedStyle(badge).backgroundColor).toBe('rgb(217, 48, 37)');
  });

  it('TC-28: close-code mapping and recovery without reload', () => {
    const states: ConnectionState[] = [];
    const c: ConnectionController = createConnectionController((s) => states.push(s));
    const last = () => states[states.length - 1];

    // 4500 → load_failed (editing locked).
    c.onProviderClose(4500);
    expect(last()).toBe('load_failed');
    expect(canEdit(last()!)).toBe(false);

    // Recovery: the provider reconnects and syncs → connected, editing on.
    c.onProviderStatus('connected');
    c.onProviderSync(true);
    expect(last()).toBe('connected');
    expect(canEdit(last()!)).toBe(true);

    // A storage-failure close (1011) after being connected → reconnecting,
    // editing still enabled (board readable, changes re-sent on reconnect).
    c.onProviderClose(1011);
    c.onProviderStatus('disconnected');
    expect(last()).toBe('reconnecting');
    expect(canEdit(last()!)).toBe(true);

    // An unsupported-data close (1003) → reconnecting as well (no lockout).
    c.onProviderClose(1003);
    c.onProviderStatus('disconnected');
    expect(last()).toBe('reconnecting');
    expect(canEdit(last()!)).toBe(true);

    // A 4500 from a fresh (never-loaded) controller locks editing…
    const c2: ConnectionController = createConnectionController(() => {});
    c2.onProviderClose(4500);
    expect(canEdit('load_failed')).toBe(false);
    // …and a subsequent successful sync re-enables it (recovery, no reload).
    c2.onProviderStatus('connected');
    c2.onProviderSync(true);
    expect(canEdit('connected')).toBe(true);
  });
});

// --- TC-23: the App in load_failed performs zero board-model mutations. ----

// Mutable state the mocked useBoardDoc returns (assigned in beforeEach).
let mockDoc: Y.Doc;
let mockNotes: readonly StickySnapshot[];
let mockState: ConnectionState;

vi.mock('../../src/client/board/useBoardDoc', () => ({
  useBoardDoc: () => ({ doc: mockDoc, notes: mockNotes, connectionState: mockState }),
}));

// Imported after the mock is registered (hoisting-safe: the factory's inner
// function reads the module-scoped lets at render time, not import time).
import App from '../../src/client/App';

describe('TC-23: App edit lock while load_failed', () => {
  let boardId: string;

  beforeEach(() => {
    // A real doc with one note so delete/drag/type have a target.
    mockDoc = new Y.Doc();
    initDoc(mockDoc);
    const id = createSticky(mockDoc, { x: 100, y: 100 });
    getStickyText(mockDoc, id)!.insert(0, 'keep me');
    mockNotes = snapshot(mockDoc);
    mockState = 'load_failed';
    boardId = 'a'.repeat(22); // any valid 22-char id
    window.history.pushState({}, '', `/b/${boardId}`);
  });

  it('create (dblclick + button), delete, drag and type are all no-ops', () => {
    // Spy on every board-model mutation the App could perform.
    const createSpy = vi.spyOn(boardModel, 'createSticky').mockImplementation(() => '');
    const deleteSpy = vi.spyOn(boardModel, 'deleteObject').mockImplementation(() => false);
    const colorSpy = vi.spyOn(boardModel, 'setStickyColor').mockImplementation(() => false);
    const moveSpy = vi.spyOn(boardModel, 'moveObject').mockImplementation(() => false);

    const { container } = render(<App />);

    // The load-failed badge is shown and the create button is disabled.
    expect(screen.getByTestId('connection-status')).toHaveTextContent(LOAD_FAILED_TEXT);
    const createBtn = screen.getByTestId('create-sticky-btn');
    expect(createBtn).toBeDisabled();

    // 1. Double-click empty board space → no note created.
    const viewport = container.querySelector('.board-viewport') as HTMLElement;
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    expect(createSpy).not.toHaveBeenCalled();

    // 2. Click the (disabled) Sticky note button → no note created.
    fireEvent.click(createBtn);
    expect(createSpy).not.toHaveBeenCalled();

    // 3. Select the existing note and press Delete → not deleted.
    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note);
    fireEvent.pointerUp(note);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(deleteSpy).not.toHaveBeenCalled();

    // 4. Drag the note → not moved.
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(note, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(note);
    expect(moveSpy).not.toHaveBeenCalled();

    // 5. Double-click the note (would enter edit mode) → stays read-only.
    fireEvent.doubleClick(note);
    // No editor appears, so there is nothing to type into; and colour/delete
    // handlers (NoteToolbar) are gated as well.
    expect(container.querySelector('[data-testid="sticky-textarea"]')).toBeNull();
    expect(colorSpy).not.toHaveBeenCalled();

    // The board model is untouched: the single note is still there, unchanged.
    const finalNotes = snapshot(mockDoc);
    expect(finalNotes).toHaveLength(1);
    expect(finalNotes[0].text).toBe('keep me');
    expect(finalNotes[0].x).toBe(mockNotes[0].x);
    expect(finalNotes[0].y).toBe(mockNotes[0].y);
  });
});
