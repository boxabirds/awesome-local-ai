import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Story 9 (text.tool_ui): active tool state for the board.
 *
 * Tools: 'select' (default) and 'text'. Stories 10-12 will add more.
 * The hook manages the active tool and reacts to `canEdit` changes
 * (when the board becomes read-only, an active Text tool reverts to Select).
 */
export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool: (t: Tool) => void;
}

export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEditRef.current) return; // can't activate text tool when read-only
    setToolState(t);
  }, []);

  // When canEdit becomes false, revert to select.
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  return { tool, setTool };
}
