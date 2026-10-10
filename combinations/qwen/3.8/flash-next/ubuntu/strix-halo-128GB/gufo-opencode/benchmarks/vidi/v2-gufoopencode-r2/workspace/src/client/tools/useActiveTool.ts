// Active board tool shared by the shape/connector tools (stories 9-12). Holds
// the active tool id and the current Shape-tool kind, and returns to Select
// after a creation. Shortcut keys and Escape are dispatched by useBoardKeys via
// TOOL_SHORTCUTS (kept in one place so the existing board keyboard handler stays
// the single source); this hook is only the tool state. Create-tools are refused
// on a board that failed to load, dropping to Select.

import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

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

// The tools that stay active across clicks and are refused when the board is
// read-only (load_failed). `sticky` is an instant create, not a mode.
const EDIT_TOOLS: readonly ToolId[] = ['text', 'shape', 'connector'];

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  // Called by a create-tool after a successful create: the item is selected by
  // the board and the active tool returns to Select (tools.return_to_select).
  toolCreated(id: string): void;
}

export function useActiveTool(canEdit = true): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  const setTool = useCallback(
    (next: ToolId) => {
      setToolState(EDIT_TOOLS.includes(next) && !canEdit ? 'select' : next);
    },
    [canEdit],
  );

  // A board that fails to load mid-session drops out of any create-tool.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const toolCreated = useCallback((_id: string) => {
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
