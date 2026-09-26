/**
 * Tool mode (stories 9, 10, 11).
 *
 * Manages the active tool state. A tool is only ever *active*, never armed: the
 * tool's component exists while the tool is chosen and does not exist otherwise,
 * and that boundary is what throws away a half-finished drawing when the person
 * picks another tool. Stories 10-12 extend this with more tools.
 */
import { useState, useEffect } from 'react';

export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

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
    // Leaving a tool mid-draw discards the stroke under the pointer, which is the
    // tool component's business, not this one's; changing it here is what makes it
    // possible at all.
    if (t === 'pen' && !canEdit) return;
    setToolState(t);
  };

  return { tool, setTool };
}