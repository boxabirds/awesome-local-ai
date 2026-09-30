// The active tool (story 9 Select/Text; story 10 Shape/Connector; story 11 Pen). Per tab, never
// stored.
import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts (cross-story convention; tools not in this build are ignored). */
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

/**
 * Tools that stay active until something is created (Pen: until another tool is chosen or
 * Escape). Sticky note is a one-off action, handled by its button and N. Image and comment
 * tools are not part of this build.
 */
export const MODE_TOOLS: ReadonlySet<ToolId> = new Set(['select', 'text', 'shape', 'connector', 'pen']);

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool created `id`: it becomes the only selected object and the tool returns to Select. */
  toolCreated(id: string): void;
}

/**
 * Active tool state: Select by default. Creating tools can only be chosen while the board can be
 * edited, and an active one returns to Select when the board becomes locked.
 */
export function useActiveTool(opts: { canEdit?: boolean; select?(id: string): void } = {}): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const select = opts.select;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: ToolId) => {
      if (!MODE_TOOLS.has(t)) return;
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );
  const toolCreated = useCallback(
    (id: string) => {
      select?.(id);
      setToolState('select');
    },
    [select],
  );
  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
