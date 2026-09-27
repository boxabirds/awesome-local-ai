// Active tool state (see spec: tools.active_tool).
//
// One hook for all tools. 'select' is the default and the only tool
// reachable while not editable: when the board becomes non-editable the tool
// reverts to 'select' immediately (story 9 behaviour, kept for all tools).
//
// TOOL_SHORTCUTS is the cross-story single-letter convention: v select,
// n sticky, t text, s shape, l connector, p pen, i image, c comment.
//
// tools.return_to_select: `toolCreated(id)` selects the new object and
// switches the tool back to 'select'. Escape while Shape or Connector is
// active returns to Select without creating (handled in useBoardKeys).
//
// Decision (NOTES.md, story 10): the 'n' shortcut keeps story 2's behaviour
// (create a sticky at the view centre) — the sticky tool itself is reached
// from the toolbar button — so useBoardKeys maps 'n' to the create action.

import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/** All board tools; 'pen', 'image' and 'comment' land in later stories. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

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

export interface ActiveTool {
  tool: ToolId;
  /** The kind the Shape tool draws (Shape menu). */
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool just created an object: select it and return to Select. */
  toolCreated(id: string): void;
}

export function useActiveTool(
  canEdit: boolean,
  selection: { select(id: string): void },
): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback(
    (t: ToolId): void => {
      setToolState(canEdit ? t : 'select');
    },
    [canEdit],
  );

  const setShapeKind = useCallback((k: ShapeKind): void => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback(
    (id: string): void => {
      selection.select(id);
      setToolState('select');
    },
    [selection],
  );

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
