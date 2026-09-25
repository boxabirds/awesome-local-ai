/**
 * The active tool of this tab (anchors: tools.active_tool, text.tool_ui). Never persisted
 * or shared.
 *
 * Select is the default. Creation tools are only available while the board can be edited:
 * setting one is ignored otherwise, and an active one returns to Select when editing
 * becomes impossible (story 4 load failure). After a shape or arrow is created,
 * `toolCreated(id)` selects it and returns to Select (tools.return_to_select); the Pen
 * (story 11) stays active after each stroke (pen.stay_active). The
 * single-letter shortcuts (TOOL_SHORTCUTS) and Escape are read by `useBoardKeys`, which
 * already knows when the keyboard belongs to a text editor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Cross-story shortcut map. N (sticky) is a one-shot create command, not a mode. */
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

/** Tools this build has (stories 12 and 16 are not part of it). */
const MODE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

export function isModeTool(t: ToolId): boolean {
  return MODE_TOOLS.has(t);
}

export interface ActiveToolApi {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A shape or arrow was created: select it and switch back to Select. */
  toolCreated(id: string): void;
}

export interface ActiveToolOptions {
  /** False while the board cannot be edited: only Select is available. Default true. */
  canEdit?: boolean;
  /** Selects a just-created object. */
  onSelect?(id: string): void;
}

export function useActiveTool(opts: ActiveToolOptions = {}): ActiveToolApi {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const onSelect = useRef(opts.onSelect);
  onSelect.current = opts.onSelect;

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback(
    (t: ToolId) => {
      if (!isModeTool(t)) return;
      if (t !== 'select' && !canEdit) return;
      setToolState(t);
    },
    [canEdit],
  );

  const toolCreated = useCallback((id: string) => {
    onSelect.current?.(id);
    setToolState('select');
  }, []);

  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
