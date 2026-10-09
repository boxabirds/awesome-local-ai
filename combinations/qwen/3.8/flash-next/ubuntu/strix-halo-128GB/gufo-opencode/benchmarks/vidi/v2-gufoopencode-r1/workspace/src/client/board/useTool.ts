import { useCallback, useEffect, useState } from 'react';

// The active pointer tool. Stories 10-12 own 'shape', 'connector' and 'pen'.
export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

// The editing tools (Text, Shape, Connector, Pen) only exist while editing is
// allowed: setTool is ignored when canEdit is false and an active editing tool
// reverts to Select.
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback(
    (t: Tool): void => {
      const editingTool = t === 'text' || t === 'shape' || t === 'connector' || t === 'pen';
      setToolState(editingTool && !canEdit ? 'select' : t);
    },
    [canEdit]
  );
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  return { tool, setTool };
}
