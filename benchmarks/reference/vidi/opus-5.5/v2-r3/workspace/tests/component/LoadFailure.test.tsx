import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/App';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import * as boardModel from '../../src/shared/board-model';
import { boardDoc, keyDown, noteEl, noteElements, noteToolbar, press, renderApp } from './helpers';

// Every board-model mutation is spied on (the real implementation still runs).
vi.mock('../../src/shared/board-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/board-model')>();
  return {
    ...actual,
    createSticky: vi.fn(actual.createSticky),
    moveObject: vi.fn(actual.moveObject),
    bringToFront: vi.fn(actual.bringToFront),
    setStickyColor: vi.fn(actual.setStickyColor),
    deleteObject: vi.fn(actual.deleteObject),
  };
});

const connections: { onState(s: ConnectionState): void }[] = [];
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: ConnectionState) => void) => {
    connections.push({ onState });
    onState('connecting');
    return { destroy() {} };
  },
}));

const MUTATIONS = ['createSticky', 'moveObject', 'bringToFront', 'setStickyColor', 'deleteObject'] as const;

function mutationCalls(): number {
  return MUTATIONS.reduce((n, name) => n + vi.mocked(boardModel[name]).mock.calls.length, 0);
}

function setState(state: ConnectionState) {
  act(() => connections[connections.length - 1].onState(state));
}

function stickyButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Sticky note' });
}

describe('canEdit (persist.client_status)', () => {
  it('is false only for load_failed', () => {
    const all: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(all.filter((s) => !canEdit(s))).toEqual(['load_failed']);
  });
});

describe('App while the board could not be loaded (persist.load_failure)', () => {
  beforeEach(() => {
    connections.length = 0;
    window.history.replaceState(null, '', '/');
  });

  it('TC-23: dblclick, Sticky note button, Delete, drag and typing change nothing', () => {
    const { viewport } = renderApp();
    // A note from before the failure (e.g. the room restarted with a damaged snapshot).
    let id = '';
    act(() => {
      id = boardModel.createSticky(boardDoc(), { x: 0, y: 0 });
    });
    setState('load_failed');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent("This board couldn't be loaded. Retrying…");
    vi.mocked(boardModel.createSticky).mockClear();
    MUTATIONS.forEach((m) => vi.mocked(boardModel[m]).mockClear());
    const before = Y.encodeStateVector(boardDoc());

    // Double-click on the empty board.
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    // The Sticky note button is disabled; a click does nothing.
    expect(stickyButton()).toBeDisabled();
    fireEvent.click(stickyButton());
    // Select the note, then press Delete and Enter.
    const note = noteEl(id);
    press(note);
    expect(noteToolbar()).toBeNull(); // no colour or delete controls
    keyDown(note, 'Delete');
    keyDown(note, 'Backspace');
    keyDown(note, 'Enter');
    // Drag it.
    fireEvent.pointerDown(note, { pointerId: 2, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(note, { pointerId: 2, clientX: 180, clientY: 160 });
    fireEvent.pointerMove(note, { pointerId: 2, clientX: 260, clientY: 220 });
    fireEvent.pointerUp(note, { pointerId: 2, clientX: 260, clientY: 220 });
    // Double-click it to type.
    fireEvent.doubleClick(note);
    expect(document.querySelector('textarea')).toBeNull();
    fireEvent.keyDown(note, { key: 'a' });

    expect(mutationCalls()).toBe(0);
    expect(noteElements()).toHaveLength(1);
    expect(note.dataset.state).toBe('idle');
    expect(note.dataset.editing).toBe('false');
    expect(Array.from(Y.encodeStateVector(boardDoc()))).toEqual(Array.from(before));
  });

  it('TC-23: an edit in progress ends when the board becomes unloadable', () => {
    renderApp();
    setState('connected');
    act(() => stickyButton().click());
    expect(document.querySelector('textarea')).not.toBeNull();
    setState('load_failed');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('TC-28 (App): editing is enabled again once the board loads', () => {
    renderApp();
    setState('load_failed');
    expect(stickyButton()).toBeDisabled();
    setState('connected');
    expect(stickyButton()).toBeEnabled();
    expect(document.querySelector('.connection-status')).toBeNull();
    act(() => stickyButton().click());
    expect(noteElements()).toHaveLength(1);
    expect(vi.mocked(boardModel.createSticky)).toHaveBeenCalled();
  });

  it('TC-28 (App): reconnecting after a storage failure keeps editing enabled', () => {
    renderApp();
    setState('connected');
    setState('reconnecting');
    expect(stickyButton()).toBeEnabled();
    act(() => stickyButton().click());
    expect(noteElements()).toHaveLength(1);
  });
});
