// Which pointer the board answers to (stories 9-12, tools.active_tool).
//
// The board has one active tool at a time. SELECT is its resting state; TEXT
// turns a press into a new text; SHAPE turns a drag into a new shape of the
// chosen kind; CONNECTOR turns a drag into a new arrow. The state belongs to
// this tab, never to the doc: another client's cursor mode is not a fact about
// the board.
//
// Three rules live here:
//  * the tools a board can actually be put into (`AVAILABLE_TOOLS`) - a
//    shortcut for a tool this build has no surface for is ignored, and for a
//    tool a later story adds this hook is where it becomes reachable;
//  * every creation tool is a mutation door, so it obeys the same single gate
//    as every other mutation path: a board this client cannot edit cannot be
//    put into it, and a board that becomes uneditable under an open tool falls
//    back to SELECT by itself;
//  * `toolCreated(id)` is how a finished creation hands the board back: the new
//    object is selected and the tool is Select again (tools.return_to_select).
//
// The keystrokes themselves are routed by useBoardKeys, which already owns the
// window's keydown listener and the "a key in a text field is typing, not a
// command" rule; it reads the shortcut table exported here, so the letters mean
// the same thing in both places and nothing listens twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config.ts';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/**
 * The single-letter shortcuts (design contract). 'n' is listed because it is a
 * tool shortcut in the product's naming, even though it creates a note instead
 * of opening a mode - which is exactly why it is absent from AVAILABLE_TOOLS.
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

/** The tools this build has a surface for; the others are ignored, not errors. */
export const AVAILABLE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

export function isAvailableTool(tool: ToolId): boolean {
  return AVAILABLE_TOOLS.includes(tool);
}

export interface ActiveToolState {
  tool: ToolId;
  /** the kind the Shape tool will draw next (shape.kind_menu) */
  shapeKind: ShapeKind;
  setTool(next: ToolId): void;
  setShapeKind(next: ShapeKind): void;
  /** a creation finished: select it and hand the board back to Select */
  toolCreated(id: string): void;
}

export interface ActiveToolOptions {
  /** false while the board cannot be edited at all (story 4 load failure) */
  canEdit?: boolean;
  /** select the object that was just created */
  onSelect?(id: string): void;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolState {
  const canEdit = options.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // The gate and the callback are read through refs so both returned functions
  // keep a stable identity even when the board's editability, or the board's
  // selection helper, changes underneath them.
  const gate = useRef(canEdit);
  gate.current = canEdit;
  const selectRef = useRef(options.onSelect);
  selectRef.current = options.onSelect;

  const setTool = useCallback((next: ToolId): void => {
    if (!isAvailableTool(next)) return; // pen, image, comment, 'sticky' as a mode
    if (next !== 'select' && !gate.current) return; // a read-only board has no creation tool
    setToolState(next);
  }, []);

  const setShapeKind = useCallback((next: ShapeKind): void => {
    if (next !== 'rect' && next !== 'ellipse' && next !== 'diamond') return;
    setShapeKindState(next);
  }, []);

  // A board that becomes uneditable loses whatever tool was open - text, shape
  // or connector - with the news; the selection, the zoom and the panning all
  // stay exactly as they were.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  // tools.return_to_select: the created object becomes the selection and the
  // tool steps aside. Selecting happens first so a board that cannot be
  // selected into still ends the tool.
  const toolCreated = useCallback(
    (id: string): void => {
      if (typeof id === 'string' && id !== '') selectRef.current?.(id);
      setTool('select');
    },
    [setTool],
  );

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
