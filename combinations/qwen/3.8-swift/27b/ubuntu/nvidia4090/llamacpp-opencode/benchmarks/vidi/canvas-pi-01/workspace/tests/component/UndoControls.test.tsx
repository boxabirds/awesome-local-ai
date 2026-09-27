// undo.controls (story 8): TC-18 to TC-21.
//
// Full-app tests for the undo/redo controls: the buttons are disabled while
// the matching history is empty or the board cannot be edited; Ctrl/Cmd+Z,
// Ctrl/Cmd+Shift+Z and Ctrl+Y call this tab's controller with preventDefault;
// on a load-failed board the shortcuts are ignored; and Ctrl+Z while focus is
// in an ordinary input (not the board) is not hijacked.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installResizeObserverMock } from './helpers';
import { board, noteAt, setConnection } from './story7-helpers';
import type { UndoController } from '../../src/client/board/undo';
import { act } from '@testing-library/react';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

/** This tab's undo controller (via the test hook). */
function undoController(): UndoController {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook not installed');
  return hook.getUndoController();
}

/** The toolbar's Undo / Redo buttons. */
function buttons() {
  const undo = document.querySelector<HTMLButtonElement>('button[aria-label="Undo"]');
  const redo = document.querySelector<HTMLButtonElement>('button[aria-label="Redo"]');
  if (undo === null || redo === null) throw new Error('undo/redo buttons not rendered');
  return { undo, redo };
}

/**
 * Dispatch a keydown on `window` with the given modifiers; returns the event
 * so the test can assert preventDefault.
 */
function key(
  keyName: string,
  opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: keyName,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** Make one undoable change (a note) so the history is non-empty. */
function withNote(fn: () => void): void {
  let id = '';
  act(() => {
    id = noteAt(0, 0);
  });
  void id;
  fn();
}

describe('undo.controls', () => {
  it('TC-18 empty history: both buttons disabled (aria-disabled)', async () => {
    await board();
    const { undo, redo } = buttons();
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    // The disabled attribute is exposed to assistive tech as aria-disabled.
    expect(undo.hasAttribute('disabled')).toBe(true);
    expect(redo.hasAttribute('disabled')).toBe(true);

    // A single change enables only the Undo button.
    withNote(() => {
      expect(undo.disabled).toBe(false);
      expect(redo.disabled).toBe(true); // nothing has been undone yet
    });
  });

  it('TC-19 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y call the controller with preventDefault', async () => {
    await board();
    withNote(() => {
      const ctrl = undoController();
      const undoSpy = vi.spyOn(ctrl, 'undo');
      const redoSpy = vi.spyOn(ctrl, 'redo');

      // Ctrl+Z → undo, default prevented.
      let e = key('z', { ctrl: true });
      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);

      // Ctrl+Shift+Z → redo, default prevented.
      e = key('z', { ctrl: true, shift: true });
      expect(redoSpy).toHaveBeenCalledTimes(1);
      expect(e.defaultPrevented).toBe(true);

      // Cmd+Z → undo, default prevented.
      e = key('z', { meta: true });
      expect(undoSpy).toHaveBeenCalledTimes(2);
      expect(e.defaultPrevented).toBe(true);

      // Cmd+Shift+Z → redo, default prevented.
      e = key('z', { meta: true, shift: true });
      expect(redoSpy).toHaveBeenCalledTimes(2);
      expect(e.defaultPrevented).toBe(true);

      // Ctrl+Y → redo, default prevented.
      e = key('y', { ctrl: true });
      expect(redoSpy).toHaveBeenCalledTimes(3);
      expect(e.defaultPrevented).toBe(true);
    });
  });

  it('TC-20 load-failed board: shortcuts ignored and buttons disabled (negative)', async () => {
    await board();
    withNote(() => {
      setConnection('load_failed');
      const ctrl = undoController();
      const undoSpy = vi.spyOn(ctrl, 'undo');
      const redoSpy = vi.spyOn(ctrl, 'redo');

      const e = key('z', { ctrl: true });
      expect(undoSpy).not.toHaveBeenCalled();
      expect(redoSpy).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false); // not consumed

      const { undo, redo } = buttons();
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);
    });
  });

  it('TC-21 Ctrl+Z with focus in a non-board input is not hijacked (negative)', async () => {
    await board();
    withNote(() => {
      const ctrl = undoController();
      const undoSpy = vi.spyOn(ctrl, 'undo');

      // An ordinary input (e.g. the share-link field): the board shortcuts
      // must not fire.
      const input = document.createElement('input');
      document.body.appendChild(input);
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        input.dispatchEvent(event);
      });

      expect(undoSpy).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      input.remove();
    });
  });
});
