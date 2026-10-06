import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { createUndo, type UndoController } from "./undo";

/**
 * The board's undo history as React state (`undo.history`, `undo.controls`).
 *
 * `App` creates exactly one controller per board document — the history belongs
 * to this tab, not to the board — and everything that needs it reaches it through
 * `UndoControllerContext`: the gesture hook, the keyboard, the note toolbar and
 * the text editor. That is why the context exists at all: `App` is the only place
 * that knows the controller, and a boundary call has to happen wherever the change
 * is made.
 *
 * `App` renders inside `<StrictMode>`, which mounts, cleans up and mounts the
 * board again. A controller handed out directly would be destroyed by that
 * cleanup while its callers still held it, so the controller that reaches the
 * rest of the board is a stable facade over a slot: the slot is filled and emptied
 * by the effect, the facade never changes identity, and every method goes to
 * whatever is in the slot at the time it is called.
 */

/** This tab's undo controller for this board, or `null` when there is no history. */
export const UndoControllerContext = createContext<UndoController | null>(null);

/** The controller this tab created for this board. */
export function useUndoController(): UndoController | null {
  return useContext(UndoControllerContext);
}

/**
 * Close the current capture window, so the next change starts a new undo step.
 * A no-op when this board has no history (a board that failed to load, a test
 * render without a provider).
 */
export function useUndoBoundary(): () => void {
  const controller = useContext(UndoControllerContext);
  return useCallback(() => {
    controller?.boundary();
  }, [controller]);
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
}

/** What this tab can undo and redo right now (`undo.controls`). */
export function useUndo(controller: UndoController | null, canEdit: boolean): UndoState {
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (controller === null) return;
    return controller.onChange(() => setHistoryVersion((version) => version + 1));
  }, [controller]);

  const undo = useCallback(() => {
    if (!canEdit) return;
    controller?.undo();
  }, [canEdit, controller]);

  const redo = useCallback(() => {
    if (!canEdit) return;
    controller?.redo();
  }, [canEdit, controller]);

  // Only read to make the point that the numbers below are re-read on change.
  void historyVersion;

  return {
    canUndo: canEdit && (controller?.canUndo() ?? false),
    canRedo: canEdit && (controller?.canRedo() ?? false),
    undo,
    redo,
  };
}

/**
 * One history for this board document, for as long as this screen holds it
 * (`undo.session_only`): it is destroyed when the document changes or the board
 * is left, and a reload starts with nothing in it.
 */
export function useUndoHistory(doc: Y.Doc): UndoController {
  const slotRef = useRef<UndoSlot | null>(null);
  if (slotRef.current === null) slotRef.current = createUndoSlot();
  const slot = slotRef.current;

  useEffect(() => {
    slot.replace(createUndo(doc));
    return () => slot.replace(null);
  }, [doc, slot]);

  return slot.controller;
}

interface UndoSlot {
  /** The controller to hand to every caller; its identity never changes. */
  controller: UndoController;
  /** Put a live controller in the slot, or take it out (`null`). */
  replace(next: UndoController | null): void;
}

function createUndoSlot(): UndoSlot {
  const listeners = new Set<() => void>();
  let current: UndoController | null = null;
  let detach: (() => void) | null = null;

  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const replace = (next: UndoController | null) => {
    if (detach !== null) detach();
    detach = null;
    current = next;
    if (next !== null) detach = next.onChange(emit);
    // The buttons need the new stack state, and so does anything else watching.
    emit();
  };

  const controller: UndoController = {
    undo: () => current?.undo() ?? false,
    redo: () => current?.redo() ?? false,
    boundary: () => current?.boundary(),
    canUndo: () => current?.canUndo() ?? false,
    canRedo: () => current?.canRedo() ?? false,
    addScope: (scope: Y.AbstractType<any>) => current?.addScope(scope),
    onChange: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy: () => replace(null),
  };

  return { controller, replace };
}
