// Story 9 board tool mode: Select (default) or Text. The Text tool creates
// text on the next board click and then reverts to Select. Editing is
// disabled whenever the board is (load_failed): the Text tool is then
// refused and the board stays on Select.

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

  const setTool = useCallback((next: Tool) => {
    setToolState(next === 'text' && !canEditRef.current ? 'select' : next);
  }, []);

  // A board that fails to load mid-session drops out of the Text tool.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool, setTool };
}
