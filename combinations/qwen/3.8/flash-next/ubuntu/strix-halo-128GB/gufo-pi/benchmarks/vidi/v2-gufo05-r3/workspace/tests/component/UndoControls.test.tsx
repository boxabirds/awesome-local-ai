/**
 * Story 8 (task 4): TC-18 to TC-21 — the controls a person uses to step back
 * through their own changes, and what they do on a board that cannot be changed.
 *
 * The shortcuts are sent to the window the way a real keystroke reaches it, and
 * the board is only ever changed through the app, so what is asserted is the
 * outcome the person sees rather than the wiring inside. The one exception is
 * TC-20, which needs the board to be genuinely locked: there the transport is a
 * fake provider that hangs up with the "this board could not be read" code,
 * exactly as `BoardLoadFailure.test.tsx` does.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

const { FakeProvider } = vi.hoisted(() => {
  /** The subset of `y-websocket`'s behaviour this file needs. */
  class FakeProvider {
    static readonly instances: FakeProvider[] = [];

    readonly doc: Y.Doc;
    synced = false;

    private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

    constructor(_url: string, _roomName: string, doc: Y.Doc) {
      this.doc = doc;
      FakeProvider.instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }

    off(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
    }

    destroy(): void {
      this.handlers.clear();
    }

    sync(): void {
      this.emit('status', { status: 'connected' });
      this.synced = true;
      this.emit('sync', true);
    }

    /** The server hung up, code in hand, exactly as a real close event arrives. */
    close(code: number): void {
      const hadConnected = this.synced;
      this.synced = false;
      this.emit('connection-close', { code, reason: 'the server said so' }, this);
      if (hadConnected) this.emit('status', { status: 'disconnected' });
    }
  }
  return { FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }));

// Imported after the mock is registered, so nothing reaches the real transport.
const App = (await import('../../src/client/App')).default;
const { UndoButtons } = await import('../../src/client/board/UndoButtons');
const { snapshot } = await import('../../src/shared/board-model');
const { CLOSE_BOARD_LOAD_FAILED } = await import('../../src/shared/protocol');
const { clickNote, noteEl, renderBoard, seedSticky, stubViewportSize } = await import(
  './boardHarness'
);

type FakeProviderInstance = InstanceType<typeof FakeProvider>;

const BOARD_ID = 'abcdefghijklmnopqrstuvwx';

stubViewportSize();

const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });
const createButton = () => screen.getByRole('button', { name: 'Sticky note (N)' });

/** A keystroke on the board: the return value is false when the app consumed it. */
const press = (key: string, modifiers: Record<string, boolean> = {}) =>
  fireEvent.keyDown(window, { key, ...modifiers });

/** A board opened over the fake transport, connected and ready. */
function liveBoard(): { provider: FakeProviderInstance } {
  render(<App boardId={BOARD_ID} />);
  const provider = FakeProvider.instances[FakeProvider.instances.length - 1]!;
  act(() => provider.sync());
  return { provider };
}

describe('undo and redo buttons (undo.buttons)', () => {
  it('TC-18 with nothing of mine to undo, both buttons say so', () => {
    const doc = new Y.Doc();
    // Notes on the board that this tab did not make: a board I have not changed
    // has nothing for me to undo, and the buttons are disabled rather than
    // silently doing nothing (`undo.own`).
    seedSticky(doc, { x: 0, y: 0 });
    renderBoard(doc);

    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    // My own change, and both become live.
    fireEvent.click(createButton());
    expect(undoButton()).toBeEnabled();
  });

  it('are below the tools, say what they do and which keys do it', () => {
    const doc = new Y.Doc();
    const { container } = renderBoard(doc);

    const toolbar = container.querySelector<HTMLElement>('[data-toolbar]');
    if (!toolbar) throw new Error('the board toolbar is missing');
    const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button')];
    // Story 10 adds the Shape button (with its kind menu) and the Connector button
    // between the sticky note and the history: the point of this assertion is that
    // undo and redo sit below every tool, so the list grows with the toolbar.
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Select (V)',
      'Text (T)',
      'Sticky note (N)',
      'Shape (S) \u2013 Rectangle',
      'Shape kind menu',
      'Connector (L)',
      'Pen (P)',
      'Image (I)',
      'Undo',
      'Redo',
    ]);
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });

  it('twelve actions are twelve undos, and one redo brings the last back (undo.steps, undo.redo)', () => {
    const doc = new Y.Doc();
    renderBoard(doc);

    for (let step = 0; step < 12; step += 1) fireEvent.click(createButton());
    expect(snapshot(doc)).toHaveLength(12);

    for (let step = 11; step >= 0; step -= 1) {
      expect(undoButton()).toBeEnabled();
      fireEvent.click(undoButton());
      expect(snapshot(doc)).toHaveLength(step);
    }
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();

    fireEvent.click(redoButton());
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('a change after an undo throws the redo history away (undo.redo_cleared)', () => {
    const doc = new Y.Doc();
    renderBoard(doc);

    fireEvent.click(createButton());
    fireEvent.click(createButton());
    expect(snapshot(doc)).toHaveLength(2);

    fireEvent.click(undoButton());
    expect(snapshot(doc)).toHaveLength(1);
    expect(redoButton()).toBeEnabled();

    // A fresh action: the undone note is gone for good, whatever it was.
    fireEvent.click(createButton());
    expect(snapshot(doc)).toHaveLength(2);
    expect(redoButton()).toBeDisabled();
  });
});

describe('the board shortcuts (undo.shortcuts)', () => {
  it('Ctrl+Z undoes the last thing this tab did', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, id));
    press('Delete');
    expect(snapshot(doc)).toHaveLength(0);

    // The keystroke is the app's, not the browser's: the page has no undo of its
    // own to fall back on.
    expect(press('z', { ctrlKey: true })).toBe(false);
    expect(snapshot(doc).map((object) => object.id)).toEqual([id]);
  });

  it('TC-19 every spelling of the shortcut works, and each is consumed', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    /** Select the note and delete it, the way a person would. */
    const remove = () => {
      clickNote(noteEl(container, id));
      press('Delete');
      expect(snapshot(doc)).toHaveLength(0);
    };
    /** Undo, and check the keystroke was the app's (`preventDefault`ed). */
    const undoWith = (modifiers: Record<string, boolean>) => {
      expect(press('z', modifiers)).toBe(false);
      expect(snapshot(doc).map((object) => object.id)).toEqual([id]);
    };
    /** Redo, likewise. */
    const redoWith = (key: string, modifiers: Record<string, boolean>) => {
      expect(press(key, modifiers)).toBe(false);
      expect(snapshot(doc)).toHaveLength(0);
    };

    // Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo. Each
    // round leaves the note deleted and one step on the undo stack, which is what
    // the next round's undo picks up.
    remove();
    undoWith({ ctrlKey: true });
    redoWith('z', { ctrlKey: true, shiftKey: true });

    undoWith({ metaKey: true });
    redoWith('z', { metaKey: true, shiftKey: true });

    undoWith({ ctrlKey: true });
    // Ctrl+Y is the third spelling of redo. Cmd+Y is deliberately not one: on the
    // Mac that keystroke belongs to the system.
    redoWith('y', { ctrlKey: true });
    expect(press('y', { metaKey: true })).toBe(true);

    // Alt+Z and Ctrl+Alt+Z are nobody's shortcut, and are left alone.
    expect(press('z', { altKey: true })).toBe(true);
    expect(press('z', { ctrlKey: true, altKey: true })).toBe(true);
  });

  it('Ctrl+Z with nothing to undo changes nothing and throws nothing', () => {
    const doc = new Y.Doc();
    const id = seedSticky(doc, { x: 0, y: 0 }, { text: 'stay' });
    renderBoard(doc);
    const before = snapshot(doc);
    expect(undoButton()).toBeDisabled();

    expect(() => press('z', { ctrlKey: true })).not.toThrow();
    expect(() => press('y', { ctrlKey: true })).not.toThrow();
    expect(() => press('z', { ctrlKey: true, shiftKey: true })).not.toThrow();

    expect(snapshot(doc)).toEqual(before);
    expect(snapshot(doc).find((object) => object.id === id)?.text).toBe('stay');
  });

  it('TC-21 a keystroke in a text field on the page is left to that field', () => {
    const doc = new Y.Doc();
    seedSticky(doc, { x: 0, y: 0 });
    renderBoard(doc);
    fireEvent.click(createButton());
    expect(snapshot(doc)).toHaveLength(2);

    // The share panel's board-link field is the design's example; it lives in
    // `BoardPage`, outside the board these tests render, so a plain text field on
    // the page stands in for it. What matters is that the shortcut listener does
    // not reach past the field it was typed into.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    try {
      // Not consumed: the browser's own undo-in-the-field still works.
      expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(input, { key: 'y', ctrlKey: true })).toBe(true);
    } finally {
      input.remove();
    }

    // The board kept the note, and there is still something to undo.
    expect(snapshot(doc)).toHaveLength(2);
    expect(undoButton()).toBeEnabled();
  });
});

describe('a board that cannot be changed (undo.not_editable)', () => {
  it('TC-20 on a board that could not be loaded, both buttons are off and the shortcuts do nothing', () => {
    const { provider } = liveBoard();

    // One change of my own, so the history is definitely not empty.
    fireEvent.click(createButton());
    expect(snapshot(provider.doc)).toHaveLength(1);
    expect(undoButton()).toBeEnabled();

    // Storage becomes unreadable: what is on screen may be stale, so nothing of
    // it may be rewritten — including a step backwards.
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');

    // The shortcuts are ignored rather than half-handled, and they are left to
    // the browser because the app did not consume them.
    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(press('z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press('y', { ctrlKey: true })).toBe(true);
    expect(snapshot(provider.doc)).toHaveLength(1);

    // And the disabled buttons do nothing on click either.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(snapshot(provider.doc)).toHaveLength(1);
  });

  it('TC-20b when a retry loads the board, the history I still hold works again', () => {
    const { provider } = liveBoard();
    fireEvent.click(createButton());
    act(() => provider.close(CLOSE_BOARD_LOAD_FAILED));
    expect(undoButton()).toBeDisabled();

    act(() => provider.sync());
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();

    fireEvent.click(undoButton());
    expect(snapshot(provider.doc)).toHaveLength(0);
    expect(redoButton()).toBeEnabled();
  });

});

describe('the buttons themselves', () => {
  it('run the commands they are given', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<UndoButtons canUndo canRedo undo={undo} redo={redo} />);

    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });
});
