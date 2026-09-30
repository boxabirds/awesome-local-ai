// Story 4, Task 7 (TC-22): the load-failure banner renders red text with an
// assertive role. TC-23: in load_failed, board edits are blocked (no model
// mutation). TC-28: provider close code 1011/1003 maps to reconnecting, never
// load_failed, and editing stays enabled.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { ConnectionStatus } from '@client/sync/ConnectionStatus';
import { wireConnection, type ConnectionState } from '@client/sync/connectBoard';
import { Board, canEdit } from '@client/App';
import { initDoc, createSticky, snapshot, type StickySnapshot } from '@shared/board-model';

// Controlled inputs for the mocked useBoardDoc used by the board (story 5: the
// router lives in `App`; the board UI itself is `Board`, mounted by `BoardPage`).
let mockDoc: Y.Doc;
let mockNotes: readonly StickySnapshot[];
let mockState: ConnectionState = 'load_failed';

vi.mock('@client/board/useBoardDoc', () => ({
  useBoardDoc: () => ({ doc: mockDoc, notes: mockNotes, connectionState: mockState }),
}));

describe('load-failure banner (TC-22)', () => {
  it('renders red load-failed text with a status role', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('connection-load-failed');
    expect(badge.className).not.toContain('connection-reconnecting');
  });

  it('does not show the load-failed banner in reconnecting state', () => {
    render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.getByRole('status').className).not.toContain('connection-load-failed');
  });
});

// --- TC-28: connection-close code mapping ---
class FakeEmitter {
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  wsconnected = true;
  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (...args: any[]) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

describe('connection-close code mapping (TC-28)', () => {
  it('maps 1011 and 1003 closes to reconnecting, never load_failed', () => {
    const emitter = new FakeEmitter();
    const states: ConnectionState[] = [];
    wireConnection(emitter, (s) => states.push(s));

    // Establish a connection first.
    emitter.emit('status', { status: 'connected' });
    emitter.emit('sync', true);
    // Transient storage failure (1011), then a second close (1003).
    emitter.emit('connection-close', { code: 1011 });
    emitter.emit('connection-close', { code: 1003 });

    expect(states).toContain('connected');
    expect(states).toContain('reconnecting');
    expect(states).not.toContain('load_failed');
    // Editing stays enabled while reconnecting.
    expect(canEdit('reconnecting')).toBe(true);
    expect(states[states.length - 1]).toBe('reconnecting');
  });

  it('maps close code 4500 to load_failed (editing disabled) and recovers on later sync', () => {
    const emitter = new FakeEmitter();
    const states: ConnectionState[] = [];
    wireConnection(emitter, (s) => states.push(s));

    emitter.emit('status', { status: 'connected' });
    emitter.emit('sync', true);
    emitter.emit('connection-close', { code: 4500 });
    expect(states[states.length - 1]).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);

    // A later successful sync recovers to connected (the provider keeps retrying).
    emitter.emit('sync', true);
    expect(states[states.length - 1]).toBe('connected');
    expect(canEdit(states[states.length - 1])).toBe(true);
  });
});

describe('editing blocked while load_failed (TC-23)', () => {
  beforeEach(() => {
    mockDoc = new Y.Doc();
    initDoc(mockDoc);
    createSticky(mockDoc, { x: 0, y: 0 }, 'yellow');
    mockNotes = snapshot(mockDoc);
    mockState = 'load_failed';
  });

  it('produces no document mutations from create / double-click / delete attempts', () => {
    let updateCount = 0;
    const onUpd = () => updateCount++;
    mockDoc.on('update', onUpd);

    render(<Board boardId="test-board" />);

    // Load-failure banner is shown.
    expect(screen.getByText("This board couldn't be loaded. Retrying…")).toBeInTheDocument();

    // 1. Toolbar "Sticky note" button (disabled in load_failed) -> no create.
    const stickyBtn = screen.getByTestId('sticky-note-btn');
    expect((stickyBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stickyBtn);

    // 2. Double-click empty board space -> no create.
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });

    // 3. Select the existing note and press Delete -> no delete.
    const noteId = mockNotes[0].id;
    const noteEl = screen.getByTestId(`sticky-note-${noteId}`);
    fireEvent.pointerDown(noteEl, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(noteEl, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Delete' });

    // 4. Drag the note -> no move.
    fireEvent.pointerDown(noteEl, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(noteEl, { button: 0, pointerId: 1, clientX: 220, clientY: 180 });
    fireEvent.pointerUp(noteEl, { button: 0, pointerId: 1, clientX: 220, clientY: 180 });

    act(() => {});

    expect(updateCount).toBe(0);
    expect(snapshot(mockDoc).length).toBe(1);
    mockDoc.off('update', onUpd);
  });

  it('allows create when connected (control: the gate is load_failed-specific)', () => {
    mockState = 'connected';
    let updateCount = 0;
    mockDoc.on('update', () => updateCount++);

    render(<Board boardId="test-board" />);

    const stickyBtn = screen.getByTestId('sticky-note-btn');
    expect((stickyBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stickyBtn);

    expect(updateCount).toBeGreaterThan(0);
    expect(snapshot(mockDoc).length).toBe(2);
  });
});
