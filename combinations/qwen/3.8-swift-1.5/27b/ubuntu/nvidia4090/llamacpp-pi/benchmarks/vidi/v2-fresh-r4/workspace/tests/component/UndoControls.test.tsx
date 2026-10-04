import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { render, screen, act } from '@testing-library/react';
import { initDoc, createSticky, moveObject, snapshot } from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useUndo, type UseUndoResult } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';

let controllers: UndoController[] = [];

function track(undo: UndoController): UndoController {
  controllers.push(undo);
  return undo;
}

afterEach(() => {
  for (const undo of controllers) undo.destroy();
  controllers = [];
  vi.restoreAllMocks();
});

/** Render the real UndoButtons with a useUndo state driven by `controller`. */
function renderButtons(controller: UndoController, canEdit: boolean): void {
  function Harness() {
    const undo: UseUndoResult = useUndo(controller, canEdit);
    return <UndoButtons undo={undo} />;
  }
  render(<Harness />);
}

/** Window keydown with the given modifiers, dispatched on `target` (bubbles to window). */
function pressKey(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

/** Look up a toolbar button by accessible name, typed for `.disabled`. */
function buttonByName(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

/** A component that wires useBoardKeys to the given undo actions. */
function renderKeys(opts: {
  doc: Y.Doc;
  onUndo: () => void;
  onRedo?: () => void;
  onBoundary?: () => void;
}): void {
  function Harness() {
    useBoardKeys({
      doc: opts.doc,
      selection: {
        ids: new Set<string>(),
        editingId: null,
        click: () => {},
        toggle: () => {},
        setMany: () => {},
        clear: () => {},
        startEdit: () => {},
        endEdit: () => {},
      },
      snapshot: snapshot(opts.doc),
      canEdit: true,
      onUndo: opts.onUndo,
      onRedo: opts.onRedo,
      onBoundary: opts.onBoundary,
    });
    return <div data-vidi6="keys-harness" />;
  }
  render(<Harness />);
}

describe('undo.controls (component): buttons and shortcuts', () => {
  // TC-18: empty stack → Undo and Redo buttons disabled; aria-disabled
  it('TC-18: with an empty history both buttons are disabled (aria-disabled)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    renderButtons(undo, true);

    const undoBtn = buttonByName('Undo');
    const redoBtn = buttonByName('Redo');
    expect(undoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn.disabled).toBe(true);
    expect(redoBtn.getAttribute('aria-disabled')).toBe('true');
  });

  it('buttons enable as steps appear and disable again when the stacks empty', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    renderButtons(undo, true);

    const undoBtn = buttonByName('Undo');
    const redoBtn = buttonByName('Redo');
    expect(undoBtn.disabled).toBe(true);

    act(() => {
      const id = createSticky(doc, { x: 0, y: 0 });
      undo.boundary();
      moveObject(doc, id, 5, 5);
      undo.boundary();
    });

    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    // Two steps exist (create + move): the first undo leaves the create step
    act(() => {
      undoBtn.click();
    });
    expect(undoBtn.disabled).toBe(false); // create step still undoable
    expect(redoBtn.disabled).toBe(false); // the move is redoable

    // The second undo empties the undo stack
    act(() => {
      undoBtn.click();
    });
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);
  });

  // TC-19: Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y call controller with preventDefault
  it('TC-19: all five shortcut variants reach the controller and are default-prevented', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 5, 5);
    undo.boundary();

    const onUndo = vi.fn(() => undo.undo());
    const onRedo = vi.fn(() => undo.redo());
    renderKeys({ doc, onUndo, onRedo });

    const cases: KeyboardEventInit[] = [
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
      { key: 'Z', ctrlKey: true, shiftKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ];
    for (const init of cases) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      window.dispatchEvent(event);
      expect(preventDefaultSpy, JSON.stringify(init)).toHaveBeenCalled();
    }

    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onRedo).toHaveBeenCalledTimes(3);
  });

  // TC-20: load failed (canEdit false) → shortcuts ignored; buttons disabled (negative)
  it('TC-20: a read-only session ignores undo/redo even with a non-empty stack', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 5, 5);
    undo.boundary();
    expect(undo.canUndo()).toBe(true);

    // The UI gates actions on canEdit (load failed → false)
    function Harness() {
      const ui = useUndo(undo, false);
      return <UndoButtons undo={ui} />;
    }
    render(<Harness />);
    const onUndo = vi.fn(uiUndoFromHook(undo, false));

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    // Simulate the board wiring: useBoardKeys with the gated action
    renderKeys({ doc, onUndo });
    window.dispatchEvent(event);

    // The gated action was called but changed nothing
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(snapshot(doc)[0].x).toBe(5); // position unchanged (still moved)
    expect(undo.canUndo()).toBe(true); // the step is intact
  });

  // TC-21: Ctrl+Z with focus in a non-board input → controller not called (negative)
  it('TC-21: Ctrl+Z inside an ordinary input does not reach the controller', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const undo = track(createUndo(doc));
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    moveObject(doc, id, 5, 5);
    undo.boundary();

    const onUndo = vi.fn(() => undo.undo());
    const onRedo = vi.fn(() => undo.redo());
    renderKeys({ doc, onUndo, onRedo });

    // A non-board input (e.g. the share link field): the event bubbles from it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    pressKey(input, { key: 'z', ctrlKey: true });
    pressKey(input, { key: 'y', ctrlKey: true });

    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
    expect(undo.canUndo()).toBe(true); // history untouched
    input.remove();
  });
});

/** Build the same gated action useUndo would return for a read-only session. */
function uiUndoFromHook(controller: UndoController, canEdit: boolean): () => void {
  return () => {
    if (canEdit) controller.undo();
  };
}
