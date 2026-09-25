/**
 * The active tool of this tab (anchor: text.tool_ui). Never persisted or shared.
 *
 * Select is the default. Text is only available while the board can be edited: setting it
 * is ignored otherwise, and an active Text tool returns to Select when editing becomes
 * impossible (story 4 load failure). Stories 10–12 add their tools here.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolApi {
  tool: Tool;
  setTool(t: Tool): void;
}

export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback(
    (t: Tool) => {
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  return { tool: canEdit ? tool : 'select', setTool };
}
