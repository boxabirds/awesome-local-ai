/**
 * Tool mode hook: manages the active tool (select or text) for the board.
 *
 * Stories 10–12 will extend the Tool type. Escape and V return to Select;
 * T activates Text (only if canEdit). When canEdit becomes false, an active
 * Text tool reverts to Select.
 */

import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Active tool state. The hook manages a simple state machine:
 * - select (default)
 * - text (activated by T key or Text button)
 *
 * When canEdit becomes false, an active Text tool reverts to Select.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // If canEdit becomes false while Text is active, revert to Select
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  return { tool, setTool };
}
