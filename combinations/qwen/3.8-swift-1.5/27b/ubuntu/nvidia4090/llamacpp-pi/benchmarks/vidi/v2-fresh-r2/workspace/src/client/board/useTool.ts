/**
 * Board tool state (story 9, text.tool; story 10, tools.active_tool).
 *
 * Tools with a tool MODE: 'select', 'text', 'shape', 'connector'. The other
 * ToolId values ('sticky', 'pen', 'image', 'comment') are part of the
 * cross-story convention (TOOL_SHORTCUTS) but have no tool mode in this
 * build: N creates a sticky at the view centre directly, and pen/image/
 * comment belong to later stories. `setTool` for those is a no-op.
 *
 * - 'text' is only available when the board is editable; when editability
 *   is lost the tool reverts to Select.
 * - `shapeKind` is the kind the Shape tool will draw (Shape menu).
 * - `toolCreated(id)` (tools.return_to_select): selects the new object and
 *   switches the tool back to Select so the item can be adjusted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import type { Selection } from './useSelection';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter tool shortcuts (cross-story convention). */
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

/** Tools that have a real tool mode in this build. */
const TOOL_MODES: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

export interface ToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** Select the just-created object and return to the Select tool. */
  toolCreated(id: string): void;
}

export function useTool(opts: { canEdit: boolean; selection: Selection }): ToolState {
  const { selection } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Revert to Select when the board becomes read-only.
  useEffect(() => {
    if (!opts.canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [opts.canEdit, tool]);

  const setTool = useCallback((next: ToolId) => {
    if (!TOOL_MODES.has(next)) return; // no tool mode in this build
    if (next === 'text' && !canEditRef.current) return;
    setToolState(next);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string) => {
    selectionRef.current.select(id);
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
