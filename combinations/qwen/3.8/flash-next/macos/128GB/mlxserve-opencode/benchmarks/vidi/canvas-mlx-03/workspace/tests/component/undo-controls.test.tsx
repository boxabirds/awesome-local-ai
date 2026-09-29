// Story 8 `undo.controls` component cases (TC-18 to TC-21): the two buttons in the
// toolbar and the two shortcuts on the window.
//
// The controller these tests pass to the board is a spy, because what is being
// checked is who the board asks. It answers `canUndo`/`canRedo` the way a real one
// does, records the calls it receives, and notifies its subscribers when its stacks
// change — which is also how the buttons are expected to learn anything at all.
//
// TC-20 and TC-21 are the negative half: a board that could not be loaded must not
// be undone by a keystroke, and a keystroke that belongs to an ordinary field on the
// page must not be taken by the board either.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup, fireEvent, within } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import type { UndoController } from '../../src/client/board/undo.ts';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model.ts';
import type { ConnectionState } from '../../src/client/board/ConnectionStatus.tsx';

interface Spy {
  controller: UndoController;
  calls: string[];
  /** Report different stacks and tell the subscribers, as a real controller does. */
  set(canUndo: boolean, canRedo: boolean): void;
}

function createSpy(canUndo = false, canRedo = false): Spy {
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const state = { canUndo, canRedo };
  const tell = () => {
    for (const cb of [...listeners]) cb();
  };
  const controller: UndoController = {
    undo: () => {
      calls.push('undo');
      state.canUndo = false;
      state.canRedo = true;
      tell();
      return true;
    },
    redo: () => {
      calls.push('redo');
      state.canUndo = true;
      state.canRedo = false;
      tell();
      return true;
    },
    boundary: () => {
      calls.push('boundary');
    },
    canUndo: () => state.canUndo,
    canRedo: () => state.canRedo,
    addScope: () => {
      calls.push('addScope');
    },
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      calls.push('destroy');
    },
  };
  return {
    controller,
    calls,
    set(a: boolean, b: boolean) {
      state.canUndo = a;
      state.canRedo = b;
      tell();
    },
  };
}

let doc: Y.Doc;
let spy: Spy;

function mountBoard(
  options: { canUndo?: boolean; canRedo?: boolean; connection?: ConnectionState; seeds?: number } = {},
) {
  doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (let i = 0; i < (options.seeds ?? 1); i++) {
    const id = createSticky(doc, { x: 300 + i * 260, y: 300 });
    getStickyText(doc, id)?.insert(0, `note ${i}`);
    ids.push(id);
  }
  spy = createSpy(options.canUndo ?? false, options.canRedo ?? false);
  render(<BoardApp doc={doc} undo={spy.controller} connection={options.connection} />);
  return { doc, ids, spy };
}

function fireKey(
  key: string,
  target: EventTarget = window,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) {
  const ev = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

const undoButton = () => screen.getByTestId('undo-button');
const redoButton = () => screen.getByTestId('redo-button');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 8 undo.controls (TC-18 to TC-21)', () => {
  it('TC-18 both buttons are disabled while there is nothing of mine to undo or redo', () => {
    mountBoard();
    const bar = within(screen.getByTestId('toolbar'));

    expect(bar.getByTestId('undo-button')).toBeInTheDocument();
    expect(undoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(undoButton()).toHaveAccessibleName('Undo');
    expect(redoButton()).toBeDisabled();
    expect(redoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(redoButton()).toHaveAccessibleName('Redo');

    // The buttons follow the controller's word, not the board's activity: they were
    // already mounted when nothing had happened, and they changed when it said so.
    act(() => spy.set(true, false));
    expect(undoButton()).not.toBeDisabled();
    expect(undoButton()).not.toHaveAttribute('aria-disabled');
    expect(redoButton()).toBeDisabled();

    fireEvent.click(undoButton());
    expect(spy.calls).toContain('undo');

    act(() => spy.set(true, true));
    fireEvent.click(redoButton());
    expect(spy.calls.filter((c) => c === 'redo')).toHaveLength(1);
  });

  it('TC-18 negative: a board only a colleague has changed offers nothing to undo', () => {
    // A real controller this time, and changes that came from somewhere else: the
    // colleague's own document, applied the way an update from a stranger is.
    const board = new Y.Doc();
    initDoc(board);
    const colleague = new Y.Doc();
    initDoc(colleague);
    const theirs = createSticky(colleague, { x: 200, y: 200 });
    getStickyText(colleague, theirs)?.insert(0, 'written by a colleague');
    Y.applyUpdate(board, Y.encodeStateAsUpdate(colleague), 'a stranger on the websocket');

    render(<BoardApp doc={board} />);
    expect(snapshot(board)).toHaveLength(1);
    expect(screen.getByTestId('undo-button')).toBeDisabled();
    expect(screen.getByTestId('redo-button')).toBeDisabled();

    // Ctrl+Z says nothing of theirs: the note, and the board, are unchanged.
    fireKey('z', window, { ctrl: true });
    expect(snapshot(board).map((n) => n.text)).toEqual(['written by a colleague']);
    expect(screen.getByTestId('undo-button')).toBeDisabled();

    board.destroy();
    colleague.destroy();
  });

  it('TC-19 Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y reach the controller', () => {
    mountBoard({ canUndo: true, canRedo: true });
    const asked = () => spy.calls.filter((c) => c === 'undo' || c === 'redo');

    expect(fireKey('z', window, { ctrl: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['undo']);

    spy.calls.length = 0;
    expect(fireKey('z', window, { meta: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['undo']);

    spy.calls.length = 0;
    expect(fireKey('z', window, { ctrl: true, shift: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['redo']);

    spy.calls.length = 0;
    expect(fireKey('Z', window, { meta: true, shift: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['redo']);

    spy.calls.length = 0;
    expect(fireKey('y', window, { ctrl: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['redo']);

    spy.calls.length = 0;
    expect(fireKey('Y', window, { meta: true }).defaultPrevented).toBe(true);
    expect(asked()).toEqual(['redo']);

    // A board shortcut that is not this one is still the page's business.
    spy.calls.length = 0;
    const plain = fireKey('z');
    expect(plain.defaultPrevented).toBe(false);
    const withAlt = fireKey('z', window, { ctrl: true, alt: true });
    expect(withAlt.defaultPrevented).toBe(false);
    expect(asked()).toEqual([]);
  });

  it('TC-19 the buttons and the shortcuts ask for the same thing', () => {
    mountBoard({ canUndo: true, canRedo: true });
    const asked = (name: string) => spy.calls.filter((c) => c === name).length;

    fireKey('z', window, { ctrl: true });
    expect(asked('undo')).toBe(1);
    act(() => spy.set(true, true)); // something of mine to undo again
    fireEvent.click(undoButton());
    expect(asked('undo')).toBe(2);

    fireKey('z', window, { ctrl: true, shift: true });
    expect(asked('redo')).toBe(1); // the chord reaches the same method as the button
    act(() => spy.set(true, true));
    fireEvent.click(redoButton());
    expect(asked('redo')).toBe(2);
  });

  it('TC-20 on a board that failed to load the shortcuts are ignored and the buttons are disabled', () => {
    mountBoard({ canUndo: true, canRedo: true, connection: 'load_failed' });

    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    // Not only unused: the keystroke is not even taken from the page.
    const chords: KeyboardEvent[] = [
      fireKey('z', window, { ctrl: true }),
      fireKey('z', window, { meta: true }),
      fireKey('z', window, { ctrl: true, shift: true }),
      fireKey('y', window, { ctrl: true }),
    ];
    for (const ev of chords) expect(ev.defaultPrevented).toBe(false);
    expect(spy.calls.filter((c) => c === 'undo' || c === 'redo')).toEqual([]);

    // Clicking a disabled button does nothing either.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(spy.calls.filter((c) => c === 'undo' || c === 'redo')).toEqual([]);
  });

  it('TC-21 Ctrl+Z inside another field on the page is not the board\u2019s undo', () => {
    mountBoard({ canUndo: true, canRedo: true });

    // The share panel's link field: an input that belongs to the page, not to a note.
    fireEvent.click(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link') as HTMLInputElement;
    field.focus();
    expect(document.activeElement).toBe(field);

    const ev = fireKey('z', field, { ctrl: true });
    expect(spy.calls.filter((c) => c === 'undo' || c === 'redo')).toEqual([]);
    expect(ev.defaultPrevented).toBe(false); // the browser's own field undo still applies

    fireKey('y', field, { ctrl: true });
    fireKey('z', field, { ctrl: true, shift: true });
    expect(spy.calls.filter((c) => c === 'undo' || c === 'redo')).toEqual([]);

    // The very same chord with the caret nowhere in a field is the board's: so it is
    // the field that decides, not the shortcut.
    (document.body as HTMLElement).focus();
    fireKey('z', window, { ctrl: true });
    expect(spy.calls).toContain('undo');
  });
});
