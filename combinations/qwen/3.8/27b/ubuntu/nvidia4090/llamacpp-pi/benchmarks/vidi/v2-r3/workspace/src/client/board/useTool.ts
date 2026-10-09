import { useCallback, useEffect, useState } from 'react';

/**
 * Story 9 (text.tool_ui): the active tool, per client.
 *
 * 'select' is the default tool; 'text' arms the text tool (a click on the
 * board creates a text object and returns to select). The tool is client
 * state only — it is never persisted in the shared doc, so each client keeps
 * its own tool. When the board becomes non-editable (load failed) an active
 * Text tool reverts to Select.
 *
 * Keyboard shortcuts (V, T, N, Escape) live in useBoardKeys, which also has
 * the "ignored while editing / focus in an input" guards.
 */
export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const setTool = useCallback((t: Tool) => setToolState(t), []);
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);
  return { tool, setTool };
}
