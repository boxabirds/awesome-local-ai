// The active tool (story 9 `text.tool_ui`).
//
// A minimal tool state for now: `select` and `text`. Stories 10-12 add their own
// tools (shape, connector, frame) and extend this union; nothing else about a tool
// belongs here. The Text tool is a *mode*: while it is active the board shows a text
// cursor and the next click on the board — empty space or on top of an object —
// creates a text there, hands the tool back to Select and starts editing the new
// object.
//
// The tool is local UI state: never shared, never persisted, and never an undo step.
// When the board can no longer be edited (story 4's load-failed state) an active Text
// tool is forced back to Select, so a disabled Text button is never left "active".

import { useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/** The active tool and its setter; a Text tool cannot survive the board locking. */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setTool] = useState<Tool>('select');
  useEffect(() => {
    if (!canEdit) setTool('select');
  }, [canEdit]);
  // Choosing Text while the board cannot be edited is ignored, not applied.
  const select = (t: Tool) => setTool(t === 'text' && !canEdit ? 'select' : t);
  return { tool, setTool: select };
}
