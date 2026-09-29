// Design story 4, contract `persist.client_status` — ui-component test TC-23.
// While the board could not be loaded, every editing path must be a no-op: no
// board-model mutation may be called, and no document update may be produced.
// The mock keeps the real implementations and only spies on them, so a gate that
// is *too* eager (or a mutation that bypasses board-model) is still detected.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

vi.mock('../../src/shared/board-model.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/board-model.ts')>();
  return {
    ...actual,
    createSticky: vi.fn(actual.createSticky),
    deleteObject: vi.fn(actual.deleteObject),
    setStickyColor: vi.fn(actual.setStickyColor),
    moveObject: vi.fn(actual.moveObject),
    bringToFront: vi.fn(actual.bringToFront),
    // Story 7 acts on the whole selection, so these are the functions the shell
    // calls now; the singular ones above are its thin wrappers. Both are spied on
    // so no mutation route can escape the lock.
    moveObjects: vi.fn(actual.moveObjects),
    resizeObjects: vi.fn(actual.resizeObjects),
    deleteObjects: vi.fn(actual.deleteObjects),
    bringObjectsToFront: vi.fn(actual.bringObjectsToFront),
  };
});

import BoardApp from '../../src/client/board/BoardApp.tsx';
import { canEdit } from '../../src/client/board/BoardApp.tsx';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
  setStickyColor,
  deleteObject,
  moveObject,
  bringToFront,
  moveObjects,
  resizeObjects,
  deleteObjects,
  bringObjectsToFront,
} from '../../src/shared/board-model.ts';
import type { ConnectionState } from '../../src/client/board/ConnectionStatus.tsx';

const mutators = {
  createSticky,
  deleteObject,
  setStickyColor,
  moveObject,
  bringToFront,
  moveObjects,
  resizeObjects,
  deleteObjects,
  bringObjectsToFront,
};

function firePointer(el: Element, type: string, x: number, y: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });
}
function fireDblClick(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}
function fireKey(key: string, target: Element | Window = window) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    (target as Window).dispatchEvent(ev);
  });
  return ev;
}
function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

let doc: Y.Doc;
let id: string;
let updates: number;

function mount(connection: ConnectionState | undefined) {
  doc = new Y.Doc();
  initDoc(doc);
  id = createSticky(doc, { x: 400, y: 300 });
  getStickyText(doc, id)!.insert(0, 'existing');
  updates = 0;
  doc.on('update', () => {
    updates += 1;
  });
  render(
    <BoardApp doc={doc} boardId={null} {...(connection === undefined ? {} : { connection })} />,
  );
  vi.clearAllMocks(); // only actions performed after setup may mutate
}

const noteEl = () => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const viewport = () => screen.getByTestId('viewport');
const stickyTool = () => screen.getByTestId('sticky-note-tool');

function expectNoMutations() {
  for (const [name, fn] of Object.entries(mutators)) {
    expect(fn, `board-model.${name} was called while load_failed`).not.toHaveBeenCalled();
  }
  expect(updates, 'document changed while load_failed').toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('story 4 persist.client_status edit lock (TC-23)', () => {
  it('TC-23 canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = [
      'connecting',
      'connected',
      'reconnecting',
      'confirmed',
      'load_failed',
    ];
    expect(states.filter(canEdit)).toEqual(['connecting', 'connected', 'reconnecting', 'confirmed']);
  });

  it('TC-23 load_failed: the message shows, the tool is disabled, nothing can be edited', () => {
    mount('load_failed');

    // The user is told, and the sticky-note tool is disabled.
    expect(screen.getByTestId('connection-status')).toHaveTextContent(
      "This board couldn't be loaded. Retrying…",
    );
    expect(stickyTool()).toBeDisabled();

    // double-click the board background: nothing is created
    fireDblClick(viewport());
    firePointer(viewport(), 'pointerdown', 700, 500);
    firePointer(viewport(), 'pointerup', 700, 500);
    fireDblClick(viewport());
    expect(snapshot(doc)).toHaveLength(1);
    expectNoMutations();

    // the toolbar button does nothing (disabled)
    fireEvent.click(stickyTool());
    expectNoMutations();

    // selecting a note is allowed, but Delete does not delete it
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointerup', 150, 150);
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    fireKey('Delete');
    fireKey('Backspace');
    expect(snapshot(doc)).toHaveLength(1);
    expectNoMutations();

    // dragging does not move it (nor raise it)
    const before = { ...snapshot(doc)[0] };
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointermove', 250, 250);
    firePointer(noteEl(), 'pointermove', 350, 320);
    firePointer(noteEl(), 'pointerup', 350, 320);
    flush();
    expect(snapshot(doc)[0]).toEqual(before);
    expectNoMutations();

    // double-clicking the note does not open the editor, so typing changes nothing
    fireDblClick(noteEl());
    flush();
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
    fireKey('Enter'); // the keyboard route into editing
    expect(screen.queryByTestId('sticky-text-editor')).not.toBeInTheDocument();
    expectNoMutations();

    // the existing text is untouched
    expect(snapshot(doc)[0].text).toBe('existing');
  });

  it('TC-23 colour and delete from the note toolbar are no-ops while load_failed', () => {
    mount('load_failed');
    // Select the note: the note toolbar appears (selection is read-only UI).
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointerup', 150, 150);
    expect(noteEl().getAttribute('data-selected')).toBe('true');
    const green = screen.getByRole('button', { name: 'Green colour' });
    fireEvent.click(green);
    fireKey('Delete');
    expect(snapshot(doc)[0].color).not.toBe('green');
    expect(snapshot(doc)).toHaveLength(1);
    expectNoMutations();
  });

  it('TC-23 control: the same actions do mutate when the board is editable again', () => {
    // The gates must be tied to the state, not blanket-blockers: after a
    // successful sync (state back to 'connected') editing works again with no reload.
    mount('connected');
    expect(stickyTool()).not.toBeDisabled();

    fireDblClick(viewport());
    expect(createSticky).toHaveBeenCalledTimes(1);
    expect(updates).toBeGreaterThan(0);
    fireKey('Escape', screen.getByTestId('sticky-text-editor')); // leave the new note's editor

    vi.clearAllMocks();
    updates = 0;
    firePointer(noteEl(), 'pointerdown', 150, 150);
    firePointer(noteEl(), 'pointerup', 150, 150);
    fireKey('Delete');
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    // the selected note is gone (the one created above is still there)
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
  });

  it('TC-23 control: a reconnecting board is still editable', () => {
    mount('reconnecting'); // close 1011 keeps the board readable (persist.save_failure)
    expect(stickyTool()).not.toBeDisabled();
    fireDblClick(viewport());
    expect(createSticky).toHaveBeenCalledTimes(1);
  });
});
