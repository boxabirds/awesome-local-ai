/**
 * Which tool the pointer is, right now — one answer for the whole board.
 *
 * Story 9 needed a tool and grew one (`board/useTool.ts`). Story 10 needs three, and needs them to be able
 * to talk to each other: the Connector tool has to hand the arrow it made to the selection and step aside,
 * the Shape tool has to remember which kind it last drew, and Escape has to mean *stop meaning that* and
 * nothing else while any of them is armed. Two hooks each holding their own idea of "the current tool" is
 * two answers to one question, and the moment they disagree a toolbar reads as Select while the board is
 * still drawing diamonds. So the tool lives here, in one hook, with the union of every tool id the stories
 * in this design use — and the tools this build does not have yet (`pen`, `image`, `comment`) are named but
 * not armable, because a cursor that does nothing is worse than no cursor.
 *
 * **One placement, then it steps aside.** `toolCreated(id)` is how a tool says it is finished: the new
 * object becomes the selection and the tool goes back to Select (tools.return_to_select). A mode that stayed
 * armed would be a board that keeps making objects at every click, which is the mistake repeated instead of
 * the intention followed; and the person who just drew an arrow wants to move it or re-drag its end, both of
 * which are Select jobs.
 *
 * **The keys are window listeners, registered before the board's own.** These are single letters, and single
 * letters collide with nothing except each other; but Escape is shared, and the order matters. While a tool
 * is armed, Escape is this tool's to answer and the answer stops there — it must not also clear the selection
 * behind it, because a person who backs out of a tool has said nothing about what is selected. Being first,
 * and stopping the key there, is what keeps one keypress to one meaning. `N` is deliberately *not* stopped:
 * the sticky note's key is a command, not a mode, and it belongs to the board's own shortcut handler.
 *
 * **Typing wins over everything.** While the focus is in a textarea — a note's, a piece of text's, a shape's
 * label — every key is a character, and no shortcut is more important than the letter somebody is pressing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { isTypingTarget } from '../board/useBoardKeys';
import type { ShapeKind } from '../../shared/config';
import { isShapeKind } from '../../shared/config';

/**
 * Every tool a board can have across the stories in this design.
 *
 * The list is wider than this build on purpose (it is the cross-story convention), so adding the pen does
 * not mean renaming anything here.
 */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/**
 * The letter that chooses each tool, as the stories specify them: `v` select, `n` sticky, `t` text,
 * `s` shape, `l` connector, `p` pen, `i` image, `c` comment.
 *
 * Exported as the map rather than as a switch, because it is a fact about the keyboard that several things
 * need to agree on — including the tooltips, which say the letter they mean.
 */
export const TOOL_SHORTCUTS: Readonly<Record<string, ToolId>> = Object.freeze({
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
});

/**
 * The tools this build can actually put the pointer in.
 *
 * `sticky` is in the shortcut map but not here, because making a note is an action the board already answers
 * on `N` and a mode that waits for a click would make two gestures for one object. `pen`, `image` and
 * `comment` are stories not told yet: their letters are left alone, so they do nothing rather than arming a
 * cursor that draws nothing.
 */
export const ARMABLE_TOOLS: readonly ToolId[] = Object.freeze(['select', 'text', 'shape', 'connector']);

/** What a tool needs from the board around it. Both are optional, so a toolbar can be drawn on its own. */
export interface ActiveToolOptions {
  /**
   * Whether this board may be written to. Not a display setting: on a board that cannot be written, a tool
   * is a promise that the next click creates something, and a promise that will not be kept is worse than
   * no promise. So the key does nothing, and a tool armed before editing was taken away is dropped.
   */
  canEdit?: boolean;
  /**
   * Make this object the selection. `toolCreated` uses it, so the arrow or shape a person just drew is the
   * thing they are working on the moment it exists — the same way a double-clicked note arrives selected.
   */
  select?(id: string): void;
}

export interface ActiveToolState {
  tool: ToolId;
  /** The kind the Shape tool will draw next, and the kind its menu shows as chosen. */
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /**
   * A tool created this object: it is selected, and the tool is done.
   *
   * Separate from `setTool('select')` because it answers a different question — one is a person choosing
   * Select, the other is a tool having finished its job — and because it carries the selection with it.
   */
  toolCreated(id: string): void;
}

/**
 * The board's tool, the keys that change it, and the kind of shape the Shape tool is holding.
 *
 * Called once, in the board, and passed down as props: the toolbar, the shape tool and the connector tool
 * are three readers of one fact, and a board whose toolbar says Select while its viewport draws diamonds is
 * a board nobody can use.
 */
export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolState {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // Read from refs inside the listener, which is installed once: the key that is pressed belongs to the
  // board that is open now, and a listener carrying a stale `canEdit` would answer a keypress with a
  // permission that has since changed.
  const armed = useRef(tool);
  armed.current = tool;
  const editable = useRef(options.canEdit);
  editable.current = options.canEdit;
  const chosen = useRef(options.select);
  chosen.current = options.select;

  const setTool = useCallback((wanted: ToolId): void => {
    // A board that cannot be written to has nothing to place, draw or connect.
    if (wanted !== 'select' && editable.current === false) return;
    if (!ARMABLE_TOOLS.includes(wanted)) return;
    setToolState(wanted);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    // The kind is stored as the key it is, so a menu that offers three cannot be handed a fourth.
    if (!isShapeKind(kind)) return;
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string): void => {
    if (typeof id === 'string' && id !== '') chosen.current?.(id);
    setToolState('select');
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Whoever has the focus has the keys. While a shape label is open for typing, `s` is a letter.
      if (isTypingTarget(event.target)) return;
      // A command key means the keystroke belongs to something else — Ctrl+T is a browser tab, and a tool
      // that stole it would be a tool that stops people opening boards in new tabs.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        // Escape is the one key shared with the board's own shortcuts, and while a tool is armed it is this
        // tool's to answer — and the answer stops here, so the same press does not also clear the selection.
        // When the tool is Select, Escape was never the tool's business and it travels on (deselect).
        if (armed.current === 'select') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        // TC-22: an unfinished drag is abandoned with it, because the tool that was holding the pointer is
        // gone and there is nothing left to draw with.
        setToolState('select');
        return;
      }

      const wanted = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (wanted === undefined) return;
      if (!ARMABLE_TOOLS.includes(wanted)) return;

      event.preventDefault();
      // The board's other shortcuts are registered on the same window and come after this one; a tool key
      // that travelled on would be a keypress with two answers, which is how one key ends up doing two
      // things the person pressing it did not ask for.
      event.stopImmediatePropagation();
      setToolState(wanted);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Editing taken away mid-tool: the tool goes back on its own, rather than staying armed and offering a
  // click that goes nowhere.
  useEffect(() => {
    if (options.canEdit === false && tool !== 'select') setToolState('select');
  }, [options.canEdit, tool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
