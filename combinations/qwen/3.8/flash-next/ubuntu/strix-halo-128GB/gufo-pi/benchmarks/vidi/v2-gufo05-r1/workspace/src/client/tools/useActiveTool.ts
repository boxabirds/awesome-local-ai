/**
 * Which tool the pointer is in (`tools.active_tool`).
 *
 * A tool is a *mode*: pressing S changes what the next click on the board means and
 * nothing else. This hook holds that one piece of state, plus the Shape tool's chosen
 * kind, and the two rules the PRD asks for:
 *
 * - **A board that cannot be written has no modes.** When `canEdit` is false a tool
 *   whose clicks would go nowhere is refused, and a tool that was already armed goes
 *   back to Select on its own — the same rule story 9 gave the Text tool, widened to
 *   every tool this family adds.
 * - **Creating something hands the pointer back.** `toolCreated(id)` makes the new
 *   object the whole selection and returns to Select (`tools.return_to_select`), so a
 *   person can adjust the thing they just made without a second action. Escape is
 *   handled by `useBoardKeys`, which already owns the one window listener and the
 *   "somebody is typing" guard — this hook deliberately installs none, so two listeners
 *   never fight over the same key.
 *
 * The keyboard mapping itself lives in `useBoardKeys`; `TOOL_SHORTCUTS` is the shared
 * table it reads and the toolbar reads to put the letter in each button's label.
 */
import { useCallback, useEffect, useState } from 'react';

import type { ShapeKind } from '../../shared/config';

/** Every tool the board can be in. Only some are modes this build acts on. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/**
 * The single-letter shortcuts, by lowercase key. The cross-story convention (stories
 * 9–12): `v` Select, `n` Sticky, `t` Text, `s` Shape, `l` Connector, `p` Pen, `i`
 * Image, `c` Comment. `useBoardKeys` acts on the ones that are modes here and leaves
 * the rest to the stories that give them a pointer.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

export interface ActiveToolHandle {
  tool: ToolId;
  /** The kind the Shape tool will draw next. */
  shapeKind: ShapeKind;
  /** Arm a tool. A non-select tool on a board that cannot write is refused. */
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /**
   * Something was just created: select it and hand the pointer back to Select
   * (`tools.return_to_select`).
   */
  toolCreated(id: string): void;
}

export interface ActiveToolOptions {
  /** False on a board that cannot be written (`tools.active_tool`). */
  canEdit?: boolean;
  /** Make `id` the whole selection — the board's `useSelection.add`. */
  select?(id: string): void;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolHandle {
  const { canEdit = true } = options;
  const [tool, chooseTool] = useState<ToolId>('select');
  const [shapeKind, chooseShapeKind] = useState<ShapeKind>('rect');

  // Keep the latest `select` without re-creating the callbacks every render.
  const selectRef = useRefFirst(options.select);

  const setTool = useCallback(
    (next: ToolId) => {
      // Refused rather than remembered: a board that cannot be written must not sit in a
      // mode whose clicks go nowhere when the connection comes back.
      if (next !== 'select' && !canEdit) return;
      chooseTool(next);
    },
    [canEdit],
  );

  const setShapeKind = useCallback((kind: ShapeKind) => chooseShapeKind(kind), []);

  const toolCreated = useCallback(
    (id: string) => {
      selectRef.current?.(id);
      chooseTool('select');
    },
    [selectRef],
  );

  // The connection dropped, or the document failed to load, while a tool was armed.
  useEffect(() => {
    if (!canEdit) chooseTool('select');
  }, [canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}

/** A ref that always holds the newest value, initialised once. */
function useRefFirst<T>(value: T): { current: T } {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
