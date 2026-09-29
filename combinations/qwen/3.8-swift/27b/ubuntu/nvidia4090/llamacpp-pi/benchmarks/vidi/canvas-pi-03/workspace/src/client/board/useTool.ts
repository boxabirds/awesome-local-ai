/**
 * Story 9: board tool state (text.tool_ui).
 *
 * `useTool(canEdit)` owns the active tool — 'select' (the story 2/7 default)
 * or 'text' (click the board to create a text object). V / T / Escape are
 * wired in useBoardKeys; the toolbar buttons call setTool. When `canEdit`
 * turns false (board `load_failed`) an active Text tool reverts to Select —
 * a locked board never gets a Text tool (text.tool_ui error path).
 *
 * Stories 10–12 extend `Tool` with more members; the contract here stays.
 */
import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  // A locked board reverts to the Select tool.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => setToolState(t), []);
  return { tool, setTool };
}
