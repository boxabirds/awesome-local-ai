import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { Selection } from '../board/useSelection';

/**
 * Every tool the board has or will have (PRD tools.return_to_select, and stories
 * 11–12 for pen, image and comment). `sticky` is the odd one out: its letter keeps
 * story 2's behaviour of creating a note straight away, so it is never *active*.
 */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/**
 * The board's single-letter tool shortcuts (design `tools.active_tool`). The keys are
 * lower-case letters; `useBoardKeys` looks the pressed key up here, so a story adds a
 * tool by adding its letter rather than by editing the key handler.
 */
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

/** What the hook gives the toolbar, the board and the tool components. */
export interface ActiveTool {
  readonly tool: ToolId;
  /** Which shape the Shape tool will draw next (PRD shape.create_click's menu). */
  readonly shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /**
   * The tool just created `id`: the new object becomes the only selected thing and
   * the tool goes back to Select, so it can be adjusted at once (tools.return_to_select).
   */
  toolCreated(id: string): void;
}

export interface ActiveToolOptions {
  /** False on a board that cannot be edited: only Select is offered (PRD text.load_failed). */
  canEdit?: boolean;
  /** The board's selection, so `toolCreated` can select what it just made. */
  selection?: Selection;
}

/**
 * Which tool is active in this tab, plus the shape kind the Shape tool will use.
 *
 * Tool state is per tab and never written to the document: two people can be in
 * different tools on the same board. A tool that cannot be used is not kept either —
 * when a board stops being editable, an active Shape tool falls back to Select, so
 * the board never sits in a mode where a click would create something the person
 * cannot have.
 */
export function useActiveTool(options: ActiveToolOptions = {}): ActiveTool {
  const { canEdit = true, selection } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const setTool = useCallback(
    (next: ToolId) => {
      setToolState((prev) => {
        if (next === prev) return prev;
        // A board that cannot be edited has no creating tools (TC-15).
        if (!canEdit && next !== 'select') return prev;
        return next;
      });
    },
    [canEdit],
  );

  // Losing the right to edit drops any creating tool that was active.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setShapeKind = useCallback((next: ShapeKind) => {
    // The kind is a choice from exactly three, whatever the caller was handed.
    if ((SHAPE_KINDS as readonly string[]).includes(next)) setShapeKindState(next);
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      selection?.click(id);
      setToolState('select');
    },
    [selection],
  );

  return useMemo(
    () => ({ tool, shapeKind, setTool, setShapeKind, toolCreated }),
    [tool, shapeKind, setTool, setShapeKind, toolCreated],
  );
}
