import { createElement } from 'react';
import { toast } from 'sonner';
import { notifyAlert, notifyStatus } from '@/lib/notify';
import { type UndoState, createUndo, realClock } from './createUndo';
import { pushUndo, removeUndo } from './undoStack';
import { UndoToast } from './UndoToast';

export const TASK_COMPLETED_TEXT = 'Task completed';
export const TASK_DELETED_TEXT = 'Task deleted';
/** After a successful Undo (of a completion or a delete). */
export const TASK_RESTORED_TEXT = 'Task restored';
export const UNDO_FAILED_TEXT = "Couldn't undo — try again";

let sequence = 0;

/**
 * A toast offering Undo for UNDO_WINDOW_MS of unpaused time (hover or focus pauses it). sonner shows it with
 * an infinite duration; our scheduler (createUndo) decides when it goes. Undo calls `inverse` once; success
 * says 'Task restored' (role=status), failure "Couldn't undo — try again" (role=alert). Cmd/Ctrl+Z reaches
 * the newest active toast through the undo stack.
 */
export function showUndoToast(opts: {
  message: string;
  inverse: () => Promise<unknown>;
  /**
   * Said after a successful Undo (story 7: 'Project restored'); 'Task restored' by default. Story 8: a function
   * gets the inverse's result and may return null to say nothing (the inverse reported the outcome itself).
   */
  restoredText?: string | ((result: unknown) => string | null);
}): void {
  let result: unknown;
  const inverse = async () => {
    result = await opts.inverse();
    return result;
  };
  const id = `undo:${++sequence}`;
  const listeners = new Set<() => void>();
  const handle = createUndo(inverse, realClock, (state: UndoState) => {
    for (const listener of listeners) listener();
    if (state === 'counting' || state === 'paused' || state === 'undoing') return;
    removeUndo(handle);
    toast.dismiss(id);
    if (state === 'undone') {
      const text = typeof opts.restoredText === 'function' ? opts.restoredText(result) : (opts.restoredText ?? TASK_RESTORED_TEXT);
      if (text !== null) notifyStatus(text);
    }
    else if (state === 'failed') notifyAlert(UNDO_FAILED_TEXT);
  });
  pushUndo(handle);
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getState = () => handle.state;
  toast.custom(
    () =>
      createElement(UndoToast, {
        message: opts.message,
        onAttention: (attending: boolean) => (attending ? handle.pause() : handle.resume()),
        onUndo: () => void handle.undo(),
        subscribe,
        getState,
      }),
    { id, duration: Number.POSITIVE_INFINITY },
  );
}
