/**
 * Which tool the pointer is, and the one rule that decides when it stops being it.
 *
 * Story 9 gave this board its first tool and told the truth about what a tool is: not a mode the
 * document knows about but this person's pointer, held in this tab, invisible to everybody else on the
 * board. Two people can stand in two tools at one moment and there is nothing to reconcile, because
 * there is nothing shared to reconcile.
 *
 * Story 10 adds two more pointers to the same idea — a shape, which is drawn by dragging a rectangle
 * out of thin air, and a connector, which is drawn by pulling an arrow from one object to another — and
 * one rule that the two of them asked for and the text tool never needed: **a tool that has just made
 * something is no longer wanted**. A person who has just drawn a box wants to move it, recolour it,
 * label it; every one of those is a thing the *selecting* pointer does. So the moment a shape or an
 * arrow lands in the document the tool hands the pointer back to Select with the new object in its
 * hand, which is what `toolCreated` below is. Escape is the same sentence said before instead of after:
 * "I did not mean to be here", and nothing is created — including when a drag is half finished, because
 * the drag belongs to the tool and the tool has just gone away.
 *
 * Two things did not change from story 9:
 * — **one tool at a time**, and it is left only by a choice — a button, a letter, or a creation;
 * — **a board that cannot be written to has no writing tool**. Not a tool that fails on its first
 *   click: a button that says it cannot be pressed, and a letter that is not answered at all.
 *
 * The list of names is wider than the list of tools. `sticky`, `pen`, `image` and `comment` are the
 * letters the design reserves for stories that have not happened yet — they are in the map so that the
 * naming scheme is written down once, and they are refused by `setTool` so that a name nobody
 * implemented cannot be entered by a stray key.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_SHAPE_KIND, SHAPE_KINDS, type ShapeKind } from '../../shared/config';

/** Every tool name this board has a letter for, implemented or reserved. */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/**
 * The letters that change the tool, exactly as the design names them.
 *
 * `v` select, `n` sticky, `t` text, `s` shape, `l` connector, `p` pen, `i` image, `c` comment.
 *
 * One of these is a lie, and deliberately: `n` does not enter a tool, because story 2 took that letter
 * for the Sticky *button*'s key — press it and a note appears in the middle of the screen, which is what
 * it still does. It is listed here because this is the map that says what the board's letters mean, and
 * the key handler answers `n` before it ever comes looking here.
 */
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

/**
 * The tools this build can actually point with.
 *
 * `sticky` is absent because there is no sticky tool: pressing its key makes a note, it does not change
 * the pointer. `image` and `comment` are absent for the plain reason that no story has drawn them yet. A
 * tool that is not here cannot be entered — `setTool` says no — which is the difference between a reserved
 * letter and a working one.
 *
 * `pen` is in it, and the pen is the first tool in this list that does not hand the pointer back: every
 * other entry makes one thing and returns to Select, and the pen makes one thing and stays. Nothing here
 * says how long a tool lasts once it is entered, because this list is not a state machine — it is the list
 * of doors, and what a person does after walking through one is the tool's own affair.
 */
export const BUILT_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector', 'pen'];

/** Whether this build has the tool, as opposed to only having a letter for it. */
export function isBuiltTool(tool: ToolId): boolean {
  return BUILT_TOOLS.includes(tool);
}

/** Everything the board is told about the tool, and the one thing it is asked to do back. */
export interface ActiveToolOptions {
  /**
   * False while the board cannot be written to. Every tool but Select is refused while it is false, and
   * a tool already standing when the board stops being writable is put back to Select — the same rule
   * story 9 learned, for the same reason: offering a pointer that would fail on its next click is worse
   * than a button that says it is unavailable.
   */
  canEdit: boolean;
  /**
   * Makes one object the whole selection.
   *
   * This is where the hook stops and the board begins. What is selected belongs to the board — the
   * selection is its state, its reducer and its prune-on-delete rule — and the only thing a tool has to
   * say about it is "the thing I just made is what this person wants next". So the board hands the hook
   * the way to say it rather than letting the hook reach into a selection it has no business holding.
   * Left out, a creation still returns the pointer to Select and leaves the selection as it was, which
   * is a tool with a wider cursor and not a broken one.
   */
  select?(id: string): void;
}

export interface ActiveToolControls {
  /** The tool this person's pointer is in. */
  tool: ToolId;
  /** Which shape the Shape tool draws. Kept with the tool rather than with the board: it is nothing but a shape. */
  shapeKind: ShapeKind;
  /** Makes `tool` the active one, except on a board that cannot be written to or a tool nobody built. */
  setTool(tool: ToolId): void;
  /** Picks the shape the Shape tool will draw next: rectangle, ellipse or diamond. */
  setShapeKind(kind: ShapeKind): void;
  /**
   * Something was created: it becomes the selection, and the pointer goes back to Select.
   *
   * One call, one intent — the two state updates are React's to batch, so no frame is ever rendered in
   * which the shape exists and the tool has not yet noticed.
   */
  toolCreated(id: string): void;
}

/**
 * The board's tool state.
 *
 * Both halves of the state are in one hook because they are the same decision: the Shape tool's kind is
 * only ever asked by the Shape tool, and a board that has a shape on it is a board that was in that tool
 * a moment ago. Splitting them would mean two places that have to agree about which tool is lit.
 */
export function useActiveTool({ canEdit, select }: ActiveToolOptions): ActiveToolControls {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  // The selection is called from a callback that is created once and outlives every render, so it is
  // read from a ref rather than being a dependency of the thing that calls it.
  const selectRef = useRef(select);
  selectRef.current = select;

  const setTool = useCallback(
    (next: ToolId) => {
      // A letter reserved for a story that has not been written is not a tool, and the key that names it
      // is left to the browser rather than being swallowed on the way to doing nothing.
      if (!isBuiltTool(next)) return;
      if (next !== 'select' && !canEdit) return;
      setToolState(next);
    },
    [canEdit],
  );

  const setShapeKind = useCallback((next: ShapeKind) => {
    // A kind this build has no drawing for is refused rather than remembered: a tool whose button says
    // "diamond" and draws a rectangle is a tool that has lied.
    if (!SHAPE_KINDS.includes(next)) return;
    setShapeKindState(next);
  }, []);

  const toolCreated = useCallback((id: string) => {
    setToolState('select');
    selectRef.current?.(id);
  }, []);

  // A board that stops being writable stops being writable *now*, and that includes the pointer that is
  // standing in a tool: the next click with it would write, and the write would go nowhere.
  useEffect(() => {
    if (canEdit) return;
    setToolState((current) => (current === 'select' ? current : 'select'));
  }, [canEdit]);

  return useMemo(
    () => ({ tool, shapeKind, setTool, setShapeKind, toolCreated }),
    [tool, shapeKind, setTool, setShapeKind, toolCreated],
  );
}
