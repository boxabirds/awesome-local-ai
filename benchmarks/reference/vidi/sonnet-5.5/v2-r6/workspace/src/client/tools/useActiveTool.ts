import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/board-model';

/** Tools that are modes of the board; 'sticky' creates at once and is not a mode (stories 11-12 add theirs). */
export type ToolId = 'select' | 'text' | 'shape' | 'connector' | 'pen';

export const TOOL_SHORTCUTS: Record<string, ToolId> = { v: 'select', t: 'text', s: 'shape', l: 'connector', p: 'pen' };

/** Tools that need an editable board and are left with Escape. */
export const DRAWING_TOOLS: readonly ToolId[] = ['text', 'shape', 'connector', 'pen'];

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A shape or arrow was created: select it and return to the Select tool. */
  toolCreated(id: string): void;
}

/**
 * The active board tool and the kind the Shape tool draws (per client, not persisted). Tools other than
 * Select need an editable board. `select` is how a created object becomes the selection.
 */
export function useActiveTool(opts: { canEdit?: boolean; select?(id: string): void } = {}): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const selectRef = useRef(opts.select);
  selectRef.current = opts.select;

  const setTool = useCallback((t: ToolId) => {
    setToolState(t === 'select' || canEdit ? t : 'select');
  }, [canEdit]);
  const toolCreated = useCallback((id: string) => {
    selectRef.current?.(id);
    setToolState('select');
  }, []);
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
