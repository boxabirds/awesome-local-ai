// Board tool state (story 9, text.tool): 'select' (the default, which also
// pans/marquees) and 'text' (click places a text object). The Text tool is
// one-shot: creating a text object (or Escape) returns to Select — the tool
// never persists across objects.

import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolApi {
  /** The active tool. */
  readonly tool: Tool;
  /** Switches the tool. */
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');

  // A board that becomes non-editable (load failure) reverts an active Text
  // tool to Select (text.not_editable).
  useEffect(() => {
    if (!canEdit && tool === 'text') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback((next: Tool): void => {
    setToolState(next);
  }, []);

  return { tool, setTool };
}
