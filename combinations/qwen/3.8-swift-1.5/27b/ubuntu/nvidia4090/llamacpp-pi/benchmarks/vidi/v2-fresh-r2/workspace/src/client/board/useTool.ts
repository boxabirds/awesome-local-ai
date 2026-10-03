/**
 * Board tool state (story 9, text.tool).
 *
 * Two tools: 'select' (default) and 'text'. The Text tool is only available
 * when the board is editable; when editability is lost the tool reverts to
 * Select. `setTool('text')` from a non-editable board is a no-op.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolState {
  tool: Tool;
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // Revert to Select when the board becomes read-only.
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((next: Tool) => {
    if (next === 'text' && !canEditRef.current) return;
    setToolState(next);
  }, []);

  return { tool, setTool };
}
