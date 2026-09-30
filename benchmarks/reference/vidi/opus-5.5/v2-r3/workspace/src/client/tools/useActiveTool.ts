import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/** Every board tool across stories 9–17 (cross-story convention). */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts (ignored while typing; see useBoardKeys). */
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
 * Tools that stay active until used (the rest are not part of this build, or
 * are one-shot actions like Sticky note). Only these can be chosen. The Pen
 * (story 11) stays active after each stroke: it never calls `toolCreated`.
 */
export const MODAL_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

/** Tools that create content: unavailable while the board cannot be edited. */
const CREATING_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['text', 'shape', 'connector', 'pen']);

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool created `id`: select only it and return to Select (tools.return_to_select). */
  toolCreated(id: string): void;
}

/**
 * Per-client active tool and shape kind, never persisted (tools.active_tool).
 * Creating tools need an editable board: while `canEdit` is false they cannot
 * be chosen and an active one reverts to Select.
 */
export function useActiveTool(opts: { canEdit?: boolean; select?(id: string): void } = {}): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const selectRef = useRef(opts.select);
  selectRef.current = opts.select;
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: ToolId) => {
      if (!MODAL_TOOLS.has(t)) return;
      if (CREATING_TOOLS.has(t) && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );
  const toolCreated = useCallback((id: string) => {
    selectRef.current?.(id);
    setToolState('select');
  }, []);
  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
