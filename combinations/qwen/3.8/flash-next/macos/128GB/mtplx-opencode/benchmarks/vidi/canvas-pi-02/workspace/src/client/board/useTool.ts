/**
 * Tool mode (story 9).
 *
 * Manages the active tool state: 'select' or 'text'. The Text tool is only
 * active when `canEdit` is true. Stories 10-12 extend this with more tools.
 */
import { useState, useEffect } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  // When canEdit becomes false, reset any active Text tool.
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  const setTool = (t: Tool): void => {
    if (t === 'text' && !canEdit) return;
    setToolState(t);
  };

  return { tool, setTool };
}