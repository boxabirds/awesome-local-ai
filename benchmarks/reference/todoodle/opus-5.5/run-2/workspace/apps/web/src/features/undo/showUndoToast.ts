import { createElement } from 'react';
import { toast } from 'sonner';
import { createUndo, realClock, type UndoHandle } from './createUndo';
import { pushUndo, removeUndo } from './undoStack';
import { UndoToast } from './UndoToast';

export const UNDO_FAILED_TEXT = "Couldn't undo — try again";
export const RESTORED_TEXT = 'Task restored';

let seq = 0;

/**
 * Focus still inside the toaster when a toast goes (Safari focuses the toast itself on click)
 * is handed back now: sonner returns it to where it was before the toaster took it. Otherwise
 * sonner does that later, whenever focus next leaves the toaster, which can close a menu the
 * user has just opened.
 */
function releaseToasterFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('[data-sonner-toaster]')) active.blur();
}

/**
 * Shows "<message> · Undo" for UNDO_WINDOW_MS of unpaused time (sonner's own timer is off: our
 * scheduler decides when it goes, so the pause is exact). Undo (the button, or Cmd/Ctrl+Z on the
 * most recent toast) calls `inverse` once: success says "Task restored" politely; failure says
 * "Couldn't undo — try again" in an alert. Returns the handle (cancel() it if the change failed).
 */
export function showUndoToast(opts: { message: string; inverse: () => Promise<unknown> }): UndoHandle {
  const id = `undo:${++seq}`;
  const handle = createUndo(opts.inverse, realClock, {
    onSettled(state) {
      removeUndo(handle);
      releaseToasterFocus();
      toast.dismiss(id);
      if (state === 'undone') toast(createElement('span', { role: 'status' }, RESTORED_TEXT));
      if (state === 'failed') toast.error(createElement('span', { role: 'alert' }, UNDO_FAILED_TEXT));
    },
  });
  pushUndo(handle);
  toast.custom(() => createElement(UndoToast, { handle, message: opts.message }), {
    id,
    duration: Number.POSITIVE_INFINITY,
    unstyled: true,
  });
  return handle;
}
