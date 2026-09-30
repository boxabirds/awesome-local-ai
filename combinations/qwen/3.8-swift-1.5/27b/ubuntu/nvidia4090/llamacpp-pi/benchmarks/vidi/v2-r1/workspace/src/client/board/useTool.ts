import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

/**
 * Active tool state (PRD tool.mode).
 *
 * - Select is the default tool.
 * - Switching to Text is ignored when editing is not allowed (load_failed,
 *   story 4 TC-23).
 * - When editing becomes disallowed while Text is active, the tool reverts
 *   to Select.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEdit) return;
    setToolState(t);
  }, [canEdit]);

  return { tool, setTool };
}
