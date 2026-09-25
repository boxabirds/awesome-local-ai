/**
 * Story 9 · task 6 — the board tool mode; story 10 · task 11 widens it with the
 * Shape and Connector tools (design "Active tool and return to Select").
 *
 * A tiny per-client tool state — `select`, `text`, `shape` or `connector` — that
 * decides what a pointer gesture on the board does: pan/marquee/select (Select),
 * write a text object (Text), size a new shape (Shape) or draw a new arrow
 * (Connector). Like selection it is never written to the `Y.Doc`; it lives only
 * in this tab.
 *
 * Three invariants the design calls out (state diagram "Per-client tool state"):
 *  - a *creating* tool that is no longer allowed (the board went read-only)
 *    reverts to Select;
 *  - the tool never blocks editing: `S` typed *inside* a text field is a
 *    character, not a tool switch (that is decided by the keyboard layer, which
 *    only calls `setTool` when nothing is focused);
 *  - a created object returns the board to Select (`toolCreated`), so the new
 *    item can be adjusted straight away (PRD `tools.return_to_select`).
 *
 * The Shape tool also remembers its own sub-choice — which of the three kinds is
 * being drawn — because the PRD asks for a persistent Shape menu rather than a
 * per-drag decision.
 */
import { useCallback, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/** The tools the board currently offers (story 11 adds the pen). */
export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

/**
 * Single-letter shortcuts (design `tools.active_tool`). Matched case-insensitively
 * by the keyboard layer; a letter with no entry here (or a letter typed while an
 * editor has focus) is ignored. `n` is deliberately absent: it *creates* a sticky
 * rather than selecting a tool.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, Tool>> = {
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
};

/** Tools that create something, and so need an editable board. */
export function isCreatingTool(tool: Tool): boolean {
  return tool !== 'select';
}

export interface ToolState {
  /** The active tool. */
  tool: Tool;
  /** Switch tools. Ignored when not allowed (a read-only board keeps Select). */
  setTool(tool: Tool): void;
  /** The kind the Shape tool will draw next. */
  shapeKind: ShapeKind;
  /** Choose the kind for the Shape menu. */
  setShapeKind(kind: ShapeKind): void;
}

/**
 * Hold the active tool. `canEdit` is read through a getter so a board that flips
 * to read-only drops an active creating tool immediately, without the tool ever
 * becoming settable again while editing is disabled.
 */
export function useTool(getCanEdit: () => boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const setTool = useCallback(
    (next: Tool) => {
      // Every creating tool is blocked on a read-only board; Select always is.
      if (isCreatingTool(next) && !getCanEdit()) return;
      setToolState((prev) => (prev === next ? prev : next));
    },
    [getCanEdit],
  );

  const setShapeKind = useCallback((next: ShapeKind) => {
    setShapeKindState((prev) => (prev === next ? prev : next));
  }, []);

  return { tool, setTool, shapeKind, setShapeKind };
}
