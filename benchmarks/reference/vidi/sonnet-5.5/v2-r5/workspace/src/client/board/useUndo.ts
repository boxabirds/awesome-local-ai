import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { createUndo, type UndoController } from './undo';

interface Held { doc: Y.Doc; ctl: UndoController; dead: boolean }

/** One controller per board doc; history is session-only and dies with the doc or the screen. */
export function useUndoController(doc: Y.Doc): UndoController {
  const [held, setHeld] = useState<Held>(() => ({ doc, ctl: createUndo(doc), dead: false }));
  let current = held;
  if (current.doc !== doc || current.dead) {
    current = { doc, ctl: createUndo(doc), dead: false };
    setHeld(current);
  }
  useEffect(() => {
    // StrictMode runs cleanup then setup again: a destroyed controller is replaced on the next render.
    if (current.dead) setHeld({ doc, ctl: createUndo(doc), dead: false });
    const mine = current;
    return () => { mine.ctl.destroy(); mine.dead = true; };
  }, [current, doc]);
  return current.ctl;
}

export function useUndo(controller: UndoController, canEdit: boolean):
{ canUndo: boolean; canRedo: boolean; undo(): void; redo(): void } {
  const [, tick] = useState(0);
  useEffect(() => controller.onChange(() => tick((n) => n + 1)), [controller]);
  const undo = useCallback(() => { if (canEdit) controller.undo(); }, [controller, canEdit]);
  const redo = useCallback(() => { if (canEdit) controller.redo(); }, [controller, canEdit]);
  return { canUndo: canEdit && controller.canUndo(), canRedo: canEdit && controller.canRedo(), undo, redo };
}
