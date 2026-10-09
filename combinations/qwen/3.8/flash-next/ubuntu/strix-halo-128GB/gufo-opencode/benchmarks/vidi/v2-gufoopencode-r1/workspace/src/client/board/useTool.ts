import { useCallback, useEffect, useState } from 'react';

// Story 9: the active pointer tool. Stories 10-12 extend this union.
export type Tool = 'select' | 'text';

// The Text tool only exists while editing is allowed: setTool('text') is
// ignored when canEdit is false and an active Text tool reverts to Select.
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback(
    (t: Tool): void => {
      setToolState(t === 'text' && !canEdit ? 'select' : t);
    },
    [canEdit]
  );
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  return { tool, setTool };
}
