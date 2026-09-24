import { useCallback, useEffect, useRef, useState } from 'react';

/** The active tool (story 9). Stories 10–12 add shapes, connectors, pen and images. */
export type Tool = 'select' | 'text';

export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';

/**
 * This viewer's active tool (never persisted or shared). Text can only be chosen while the
 * board can be edited, and an active Text tool reverts to Select as soon as it cannot
 * (text.not_editable). Keyboard shortcuts are wired in useBoardKeys.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback((t: Tool) => {
    if (t !== 'select' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  return { tool: canEdit ? tool : 'select', setTool };
}
