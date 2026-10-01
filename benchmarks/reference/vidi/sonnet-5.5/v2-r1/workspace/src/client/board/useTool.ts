import { useCallback, useEffect, useState } from 'react';
import type { ToolId } from '../tools/useActiveTool';

export type Tool = ToolId;

/** The tools that exist in this build (the others are placeholders for later stories). */
const AVAILABLE: ReadonlySet<Tool> = new Set<Tool>(['select', 'text', 'shape', 'connector']);

/** The active board tool (per client, not persisted). Every tool but Select is unavailable, and reverts to Select, while the board cannot be edited. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback(
    (next: Tool) => setToolState(next === 'select' || (canEdit && AVAILABLE.has(next)) ? next : 'select'),
    [canEdit],
  );
  return { tool: canEdit ? tool : 'select', setTool };
}
