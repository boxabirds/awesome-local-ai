import { useCallback, useEffect, useRef, useState } from 'react';

export type Tool = 'select' | 'text';

export interface UseToolResult {
  tool: Tool;
  setTool(t: Tool): void;
}

/**
 * Active tool state for the board. Only 'select' is allowed when canEdit is false.
 */
export function useTool(canEdit: boolean): UseToolResult {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // When canEdit becomes false, revert to select if currently on text
  useEffect(() => {
    if (!canEdit) {
      setToolState((prev) => (prev !== 'select' ? 'select' : prev));
    }
  }, [canEdit]);

  const setTool = useCallback((t: Tool) => {
    if (t === 'text' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  return { tool, setTool };
}
