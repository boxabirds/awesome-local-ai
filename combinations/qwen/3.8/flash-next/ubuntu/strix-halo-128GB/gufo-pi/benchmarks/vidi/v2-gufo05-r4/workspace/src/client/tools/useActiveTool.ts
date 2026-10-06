/**
 * Which tool the board's pointer is holding, for every story that offers one
 * (`tools.active_tool`).
 *
 * Story 9 gave the board its first tool with a mode; story 10 adds a Shape tool and a
 * Connector tool, and stories 11 and 12 add more. That is why this is one hook with one
 * list of tools rather than a `useState` in whichever story arrived first: the rules below
 * are the same for every tool, and a tool that broke one of them would look like a bug in
 * the story that owned it.
 *
 *  - the tool is **local**. Nobody else needs to know that you are holding the Shape tool:
 *    it changes nothing on the board until you release the drag, and what it then changes
 *    arrives as an ordinary document update. So this state is not in `Y.Doc`, is not synced
 *    and is not persisted — a refresh returns the pointer to Select.
 *  - the tool is **read by four places**: the toolbar (which button is lit), the viewport
 *    (the cursor, and what a press means), the keyboard (V, T, S, L, Escape) and the board
 *    screen (which selects and edits whatever the tool created).
 *  - **a tool that made something is spent** (`tools.return_to_select`): `toolCreated(id)`
 *    makes the new object the selection and puts the pointer back to Select, so the thing
 *    that just arrived can be moved, resized or typed into without a second click elsewhere.
 *    The alternative — staying in the tool — turns every click into a new object, which is
 *    right for a wall of sticky notes and wrong for drawing one flow diagram.
 *  - **a tool the board cannot offer is not entered.** On a board that failed to load there
 *    is nothing to place (`text.limit_access`), and a tool this build has no component for
 *    (`pen`, `image`, `comment` — stories 11 and 12) would leave the pointer holding
 *    something nothing can draw. Asking for either leaves the tool exactly as it was.
 *
 * Escape is not handled here: it belongs to `useBoardKeys`, which already decides which key
 * presses are the board's and calls `setTool('select')`. A tool in the middle of a drag is
 * cancelled by that — the component holding the drag is unmounted, and an unmounted gesture
 * writes nothing (`tools.return_to_select`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isShapeKind, type ShapeKind } from '../../shared/objects/shape';

/**
 * Every tool a story in this project has, or will, put in the palette.
 *
 * `sticky` is here because every whiteboard's palette has it and the shortcut `N` belongs to
 * it; in this build it is an *action* rather than a mode — one press, one note in the middle
 * of the view (`sticky.create`) — so it is never the active tool, and `N` is answered by
 * `useBoardKeys` rather than by this hook.
 */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/**
 * The letter each tool is picked up with (`sel.keyboard`'s rule: an unmodified key, so
 * `Ctrl+N` and `Cmd+T` stay the browser's).
 *
 * The whole cross-story table lives here so two stories cannot claim the same letter without
 * noticing. `c` is comment rather than connector because story 10 arrived first with `l`.
 */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment'
};

/**
 * The tools this build can actually hold: a mode with a component behind it.
 *
 * `sticky` is an action, not a mode, and the last three are stories 11 and 12 — their letters
 * do nothing until their tools exist.
 */
export const MODE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector'];

/**
 * Which tool the letter `key` selects, or null when it selects none: an unknown letter, a
 * letter with a tool this build does not have, or `N`, which is a thing to do rather than a
 * mode to hold.
 *
 * Case is ignored — the keyboard hands over `S` as readily as `s` — but a bare modifier means
 * nobody: `useBoardKeys` refuses modified keys before it asks this question.
 */
export function modeForShortcutKey(key: string): ToolId | null {
  if (typeof key !== 'string' || key.length !== 1) return null;
  const tool = TOOL_SHORTCUTS[key.toLowerCase()];
  if (!tool || !MODE_TOOLS.includes(tool)) return null;
  return tool;
}

export interface ActiveToolOptions {
  /** False while the board cannot be written to (story 4): no tool that writes is offered. */
  canUseTools?: boolean;
  /**
   * Make `id` the selection. Given by the board screen from `useSelection`; the hook knows
   * nothing about how a selection is held (`tools.return_to_select`).
   */
  onSelect?(id: string): void;
}

export interface ActiveTool {
  /** The tool the pointer is holding. `select` is the board's resting state. */
  tool: ToolId;
  /** Which shape the Shape tool will draw (`shape.kinds`). */
  shapeKind: ShapeKind;
  /** Hold `tool`. One the board cannot offer leaves the tool as it was. */
  setTool(tool: ToolId): void;
  /** Choose the shape the Shape tool draws; a kind that does not exist is ignored. */
  setShapeKind(kind: ShapeKind): void;
  /** The tool made `id`: select it and go back to Select. */
  toolCreated(id: string): void;
}

/**
 * The board's active tool.
 *
 * Callable with no options, which is what a test that only wants the state machine asks for;
 * the board screen passes whether the board can be written to and how to select.
 */
export function useActiveTool(options: ActiveToolOptions = {}): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // Handlers that are created once read the current values through a ref, so a callback
  // handed to the toolbar never goes stale when the connection changes.
  const canUseToolsRef = useRef(options.canUseTools !== false);
  canUseToolsRef.current = options.canUseTools !== false;
  const onSelectRef = useRef(options.onSelect);
  onSelectRef.current = options.onSelect;

  const setTool = useCallback((next: ToolId) => {
    // A tool nothing can draw, or nothing can use, is not entered — the pointer keeps what
    // it already held rather than landing in a state the palette cannot explain.
    if (!MODE_TOOLS.includes(next)) return;
    setToolState(canUseToolsRef.current ? next : 'select');
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    // Choosing a kind is not leaving the tool, so only the kind changes.
    if (isShapeKind(kind)) setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string) => {
    if (typeof id === 'string' && id !== '') onSelectRef.current?.(id);
    setToolState('select');
  }, []);

  // A board that stops being writable stops offering the tools that write: the lit button and
  // what the pointer can do have to agree.
  useEffect(() => {
    if (options.canUseTools === false) setToolState('select');
  }, [options.canUseTools]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
