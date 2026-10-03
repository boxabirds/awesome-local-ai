// The board's active tool (story 9). See the text.tool_ui contract.
//
// Per-client, never persisted: which tool this person is holding is their own
// business and must never appear on anyone else's screen. So far there are two —
// `select` (the default: click selects, drag pans / moves) and `text` (the next
// click on the board places a text object there, then the tool returns to Select).
// Stories 10-12 add their tools here; the shape is deliberately tiny.
//
// `canEdit` is the only lock the tool respects: a board that failed to load cannot
// hold the Text tool, so asking for it is ignored and — if the board *becomes*
// uneditable while Text is held — the tool falls back to Select (text.not_editable).

import { useCallback, useEffect, useRef, useState } from 'react';

/** The tools this story ships. Stories 10-12 extend this union. */
export type Tool = 'select' | 'text';

export interface ToolApi {
  /** The tool currently held. */
  tool: Tool;
  /**
   * Hold `tool`. Asking for a non-select tool while the board cannot be edited is
   * ignored (it stays whatever it was).
   */
  setTool(t: Tool): void;
}

/**
 * The active-tool state. Reads the latest `canEdit` through a ref so `setTool` keeps
 * a stable identity (safe as an effect dependency), and drops back to Select whenever
 * the board stops being editable.
 */
export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((t: Tool): void => {
    // Only the Text tool (and any later non-select tool) needs the board editable.
    if (t !== 'select' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  // A board that becomes uneditable mid-tool drops Text back to Select.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool, setTool };
}
