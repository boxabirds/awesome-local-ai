import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select', n: 'sticky', t: 'text', s: 'shape', l: 'connector', p: 'pen', i: 'image', c: 'comment',
};

/** Tools this build lets the user switch to; sticky is an instant action and the rest belong to later stories. */
export const ACTIVE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

/**
 * Per-client active tool (never persisted). Tools other than Select are only available while the board can be
 * edited. `toolCreated` makes the new item the only selection and returns to Select.
 */
export function useActiveTool(opts: { canEdit?: boolean; select?(id: string): void } = {}): {
  tool: ToolId; shapeKind: ShapeKind; setTool(t: ToolId): void; setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
} {
  const { canEdit = true, select } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const setTool = useCallback((t: ToolId) => setToolState(t), []);
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const toolCreated = useCallback((id: string) => {
    select?.(id);
    setToolState('select');
  }, [select]);
  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
