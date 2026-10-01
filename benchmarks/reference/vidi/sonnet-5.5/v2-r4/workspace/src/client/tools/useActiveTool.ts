import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';
export type Tool = ToolId;

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

/** Tools of this build that are modes of the board (the others are one-shot actions or not built). */
const MODE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];
/** Tools that create something and so need an editable board. */
const EDIT_TOOLS: readonly ToolId[] = ['text', 'shape', 'connector'];

export function isModeTool(t: ToolId): boolean {
  return MODE_TOOLS.includes(t);
}

/**
 * The active board tool and the shape kind of the Shape menu, local to this tab. Creating tools need an editable
 * board and fall back to Select without one; `toolCreated` selects the new item and returns to Select.
 */
export function useActiveTool(opts: { canEdit?: boolean; select?(id: string): void } = {}): {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
} {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: ToolId) => {
      if (!isModeTool(t)) return;
      setToolState(EDIT_TOOLS.includes(t) && !canEdit ? 'select' : t);
    },
    [canEdit],
  );
  const { select } = opts;
  const toolCreated = useCallback(
    (id: string) => {
      select?.(id);
      setToolState('select');
    },
    [select],
  );
  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
