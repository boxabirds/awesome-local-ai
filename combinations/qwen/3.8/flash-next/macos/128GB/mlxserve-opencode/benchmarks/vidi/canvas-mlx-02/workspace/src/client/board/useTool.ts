// Which pointer the board answers to (story 9, tool.mode).
//
// The board has two tools, and exactly one is active at a time: SELECT, the
// board's whole life until now, and TEXT, which turns a press on the board -
// anywhere, over anything - into a new text at the pressed point. The state is
// this tab's, never the doc's: another client's cursor mode is not a fact
// about the board.
//
// The TEXT tool is a mutation door, so it obeys the same one gate as every
// other mutation path: a board this client cannot edit cannot be put into text
// mode at all, and a board that becomes uneditable while the TEXT tool is open
// falls back to SELECT by itself.
import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolState {
  tool: Tool;
  /** Ask for a tool. 'text' is ignored on a board that cannot be edited. */
  setTool(next: Tool): void;
}

export function useTool(canEdit: boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');

  // The gate is read through a ref so `setTool` keeps a stable identity even
  // when the board's editability changes underneath the callbacks that hold it.
  const gate = useRef(canEdit);
  gate.current = canEdit;

  const setTool = useCallback((next: Tool): void => {
    if (next !== 'select' && next !== 'text') return;
    if (next === 'text' && !gate.current) return; // a read-only board has no text tool
    setToolState(next);
  }, []);

  // A board that becomes uneditable loses the text tool with the news; the
  // selection, the zoom and the panning all stay exactly as they were.
  useEffect(() => {
    if (!canEdit) setToolState((t) => (t === 'text' ? 'select' : t));
  }, [canEdit]);

  return { tool, setTool };
}
