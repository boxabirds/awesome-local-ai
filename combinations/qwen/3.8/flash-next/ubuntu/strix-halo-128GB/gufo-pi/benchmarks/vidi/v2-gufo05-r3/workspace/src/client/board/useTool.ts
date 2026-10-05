/**
 * Tool mode for the board (story 9).
 *
 * Per-client state: which tool is active. Not persisted in the Y.Doc.
 * Stories 10-12 extend the Tool type.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Manages the active tool state.
 *
 * @param canEdit - False while the board cannot be edited.
 *   When canEdit becomes false, an active Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // When canEdit becomes false, revert text to select.
  const prevCanEdit = useRef(canEdit);
  useEffect(() => {
    if (!canEdit && prevCanEdit.current) {
      setToolState('select');
    }
    prevCanEdit.current = canEdit;
  }, [canEdit]);

  return { tool, setTool };
}
