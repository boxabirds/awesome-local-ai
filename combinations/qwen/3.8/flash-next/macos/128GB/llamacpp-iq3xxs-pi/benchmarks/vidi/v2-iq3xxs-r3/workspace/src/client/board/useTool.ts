import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which tool the pointer is (`text.tool_ui`).
 *
 * `select` is story 1's board: a press on empty space pans, Shift+drag draws a
 * marquee, a click on an object selects it. `text` turns the same press into a
 * sentence: a click anywhere — including on top of an object, which is how a
 * heading gets placed over the cluster of notes it is about — leaves a text
 * object there, in edit mode, and hands the pointer back to `select`.
 */
export type ToolMode = 'select' | 'text';

export interface ToolController {
  readonly tool: ToolMode;
  /** Asking for the Text tool on a board that cannot be written to selects instead. */
  setTool(tool: ToolMode): void;
}

/**
 * The tool this screen is holding, and the two rules that go with it.
 *
 * A tool that writes is only offered where writing works: `setTool('text')` is
 * refused while `canEdit` is false, and a Text tool that was already open when
 * bad news arrived (a room that could not be read, a board that went read-only)
 * is taken away with the pencil. The second rule is the one that matters — it is
 * what stops a click on a board that cannot accept it from looking like a
 * heading that vanished.
 */
export function useTool(canEdit: boolean): ToolController {
  const [mode, setMode] = useState<ToolMode>('select');
  const editable = useRef(canEdit);
  editable.current = canEdit;

  const setTool = useCallback((next: ToolMode): void => {
    setMode(next === 'text' && !editable.current ? 'select' : next);
  }, []);

  useEffect(() => {
    if (!canEdit) setMode('select');
  }, [canEdit]);

  return { tool: mode, setTool };
}
