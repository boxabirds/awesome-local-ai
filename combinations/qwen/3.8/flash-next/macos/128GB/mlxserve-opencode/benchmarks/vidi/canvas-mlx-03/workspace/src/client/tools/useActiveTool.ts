// The active tool (stories 9-12 `tools.active_tool`).
//
// One hook owns the answer to "which tool is armed right now", because the answer is
// needed in three places at once: the toolbar (which button is pressed, which kind
// menu is open), the keyboard (V / T / S / L, Escape) and the board surface (which
// tool takes the next pointer gesture). The tool is *local UI state*: never shared,
// never persisted, never an undo step.
//
// The letter map is the cross-story convention, so a story never invents its own
// shortcut: v select, n sticky, t text, s shape, l connector, p pen, i image,
// c comment. Letters whose tool this build does not implement yet are ignored
// rather than arming a tool that would swallow clicks and do nothing.
//
// Every tool except Select *creates* something, so on a board that cannot be edited
// (story 4's load-failed state) those tools cannot be armed and an armed one is
// forced back to Select — a disabled button is never left pressed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config.ts';

/** Every tool id the tool bar knows how to name, including later stories'. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** The single-letter shortcuts, shared by every story's tool. */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

/** The tools this build actually implements; any other id is not armable. */
export const AVAILABLE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

/**
 * The tools whose whole job is to create an object. `sticky` is in the list because
 * its button creates one immediately: none of them may be armed on a board that
 * cannot be edited.
 */
const CREATING_TOOLS: readonly ToolId[] = ['sticky', 'text', 'shape', 'connector'];

/** The tool a letter selects, or undefined for a letter that is no tool's. */
export function toolForShortcut(key: string | undefined): ToolId | undefined {
  if (!key || key.length !== 1) return undefined;
  return TOOL_SHORTCUTS[key.toLowerCase()];
}

export interface ActiveTool {
  /** The armed tool; 'select' is the resting state. */
  tool: ToolId;
  /** The shape kind the Shape tool will draw next (the Shape menu's choice). */
  shapeKind: ShapeKind;
  /** Arm a tool. An unknown id is ignored; a creating tool is refused when locked. */
  setTool(t: ToolId): void;
  /** Choose the shape kind (Rectangle / Ellipse / Diamond). */
  setShapeKind(k: ShapeKind): void;
  /**
   * A tool just created `id`: select it and hand the board back to Select, so one
   * gesture draws one object and the next click is a normal click
   * (tools.return_to_select).
   */
  toolCreated(id: string): void;
}

export interface UseActiveToolOptions {
  /** False on a board that could not be loaded: no creating tool may be armed. */
  canEdit?: boolean;
  /** Select the object a tool has just created. */
  select?(id: string): void;
}

/**
 * The armed tool, the shape kind and the return-to-Select rule.
 *
 * `select` and `canEdit` are read through refs, so the callbacks a board receives
 * here are stable and never act on a stale selection or edit lock.
 */
export function useActiveTool(options: UseActiveToolOptions = {}): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const canEditRef = useRef(options.canEdit ?? true);
  canEditRef.current = options.canEdit ?? true;
  const selectRef = useRef(options.select);
  selectRef.current = options.select;

  const setTool = useCallback((t: ToolId) => {
    // An unknown tool id, or one this build has no UI for, is ignored: pressing a
    // letter that belongs to a later story must not arm a dead tool.
    if (!AVAILABLE_TOOLS.includes(t)) return;
    if (CREATING_TOOLS.includes(t) && !canEditRef.current) {
      setToolState('select');
      return;
    }
    // Re-pressing the armed tool's button puts the tool away: Select is the board's
    // resting state, so a second click is never a way to get stuck in a tool.
    setToolState((current) => (current === t ? 'select' : t));
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    if (!(SHAPE_KINDS as readonly string[]).includes(k)) return;
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    selectRef.current?.(id);
    setToolState('select');
  }, []);

  // A board that locks while a creating tool is armed drops back to Select, so a
  // pressed button is never left offering an action the board refuses (TC-15).
  useEffect(() => {
    if (!canEditRef.current) setToolState('select');
  }, [options.canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
