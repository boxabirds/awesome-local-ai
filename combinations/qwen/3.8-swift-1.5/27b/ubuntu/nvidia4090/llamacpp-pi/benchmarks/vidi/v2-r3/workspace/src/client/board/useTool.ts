import { useCallback, useEffect, useRef, useState } from 'react';

/** The board's active tool (story 9: Select and Text). */
export type Tool = 'select' | 'text';

/**
 * Story 9 (text tool state): the active tool with the PRD's rules —
 * - T activates Text only when the board is editable (read-only → Select);
 * - V / Escape always return to Select;
 * - if the board becomes read-only while Text is active, it falls back to
 *   Select automatically (text.tool_state).
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool: (t: Tool) => void } {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  useEffect(() => {
    if (!canEdit && tool === 'text') setToolState('select');
  }, [canEdit, tool]);

  return { tool, setTool };
}
