/**
 * Story 10: the active board tool hook (tools.active_tool), generalising
 * story 9's `useTool`.
 *
 * - `ToolId` is the cross-story union; this story implements
 *   select/text/shape/connector (pen/image/comment and the sticky action
 *   arrive with their own stories — their shortcut entries stay in
 *   TOOL_SHORTCUTS per the cross-story convention and are inert here).
 * - `shapeKind` + `setShapeKind` back the Shape button's kind menu
 *   (Rectangle / Ellipse / Diamond).
 * - `toolCreated(id)` is the return-to-Select rule (tools.return_to_select):
 *   after a shape or arrow is created it selects the new item and switches
 *   the active tool back to Select, so the new item can be adjusted.
 * - Escape while Shape/Connector is active returns to Select without
 *   creating anything (wired in useBoardKeys).
 * - A locked board (load_failed) reverts to Select, as in story 9.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ShapeKind } from 'src/shared/objects/shape';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Cross-story single-letter tool map (story 10 implements the first four). */
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

/** Tools with a real gesture/behaviour in this story; others are no-ops. */
export const AVAILABLE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  'text',
  'shape',
  'connector',
]);

export interface ActiveToolOptions {
  /** False when the board is `load_failed` (the tool reverts to Select). */
  canEdit: boolean;
  /** Selects an object (the new item after creation). */
  select: (id: string) => void;
}

export function useActiveTool(opts: ActiveToolOptions): {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
} {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // A locked board reverts to the Select tool.
  useEffect(() => {
    if (!opts.canEdit && tool !== 'select') setToolState('select');
  }, [opts.canEdit, tool]);

  const setTool = useCallback((t: ToolId) => {
    if (!AVAILABLE_TOOLS.has(t)) return; // unimplemented tool: ignored
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);

  // Return to Select after creating (tools.return_to_select): select the new
  // item and switch the tool back to Select.
  const toolCreated = useCallback(
    (id: string) => {
      opts.select(id);
      setToolState('select');
    },
    [opts.select],
  );

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
