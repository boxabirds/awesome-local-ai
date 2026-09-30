import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/** Every board tool id (cross-story convention). Only AVAILABLE_TOOLS exist in this build. */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts (without Ctrl/Cmd/Alt, never while typing). */
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
 * Tools that are modes in this build. `sticky` is an action (a note at the view
 * centre, story 2); pen, image and comment belong to stories not built here.
 */
export const MODE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

/** Tools that create objects: unavailable while the board cannot be edited. */
const EDITING_TOOLS: readonly ToolId[] = ['text', 'shape', 'connector'];

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool created `id`: it becomes the only selected object and the tool returns to Select. */
  toolCreated(id: string): void;
}

/**
 * The active board tool (per client, never persisted). Editing tools cannot be
 * chosen without `canEdit`, and an active one reverts to Select when editing
 * stops being possible. `onSelect` makes a newly created object the selection.
 */
export function useActiveTool(opts: { canEdit?: boolean; onSelect?(id: string): void } = {}): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const [state, setState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const onSelect = useRef(opts.onSelect);
  onSelect.current = opts.onSelect;
  useEffect(() => {
    if (!canEdit) setState('select');
  }, [canEdit]);
  const setTool = useCallback(
    (t: ToolId) => {
      if (!MODE_TOOLS.includes(t)) return;
      if (EDITING_TOOLS.includes(t) && !canEdit) return;
      setState(t);
    },
    [canEdit],
  );
  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);
  const toolCreated = useCallback((id: string) => {
    onSelect.current?.(id);
    setState('select');
  }, []);
  return { tool: canEdit ? state : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
