/**
 * Tool mode (stories 9, 10).
 *
 * Manages the active tool state. Stories 10-12 extend this with more tools.
 */
import { useState, useEffect } from 'react';

export type Tool = 'select' | 'text' | 'shape' | 'connector';

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