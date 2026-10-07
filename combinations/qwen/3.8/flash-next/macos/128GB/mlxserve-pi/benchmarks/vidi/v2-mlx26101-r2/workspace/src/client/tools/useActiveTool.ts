import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isShapeKind, type ShapeKind } from '../../shared/config.js';
import type { UseSelectionResult } from '../board/useSelection.js';

/**
 * The tool the pointer is set to (`src/client/tools/useActiveTool.ts`).
 *
 * The list is the whole toolbar of the product, not only what this build has. The
 * shortcuts are already assigned by the PRD, and a story that adds a tool later
 * must not have to move a letter that a person's left hand already knows - so the
 * keys are declared here in full, and only the ones with a tool behind them do
 * anything today. The letters that have no tool yet (`N`, `I`, `C`) are recognised
 * and ignored: `N` in particular keeps doing what it has done since story 2 - making
 * a note where the view is - which is a creation rather than a mode, and story 2's
 * own handler owns it. Story 11 filled in `P`.
 */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** One letter per tool, as the PRD's "shortcuts" column fixes them. */
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

/**
 * The tools this build can actually be put into. A letter that names any other
 * tool is a shortcut this build does not have yet.
 *
 * The Pen is the fourth drawing tool and the first that stays in the hand: the other
 * three call `toolCreated` and go back to Select when they have made their one thing,
 * and the pen does not, because a person who draws one line is drawing several
 * (`pen.stay_active`). Being in the list is the whole of what entering it means here -
 * the pen keeps its own state and its own gestures, like the other two drawing tools.
 */
export const AVAILABLE_TOOLS: readonly ToolId[] = ['select', 'text', 'shape', 'connector', 'pen'];

/** Whether a tool can be entered at all in this build. */
export const isAvailableTool = (tool: ToolId): boolean => AVAILABLE_TOOLS.includes(tool);

/** Whether a letter is a tool shortcut at all (an unknown letter is not). */
export const toolForShortcut = (key: string): ToolId | undefined => TOOL_SHORTCUTS[key.toLowerCase()];

/** What the hook hands the board. */
export interface ActiveTool {
  tool: ToolId;
  /** The shape the Shape tool will draw next. */
  shapeKind: ShapeKind;
  /** Enter a tool. Entering one this build has not is ignored. */
  setTool(tool: ToolId): void;
  /** Which shape the Shape tool draws. A kind this build has not is ignored. */
  setShapeKind(kind: ShapeKind): void;
  /**
   * A tool just made something: it is the selection, and the board is back in
   * Select (`tools.return_to_select`) so the new thing can be adjusted at once.
   */
  toolCreated(id: string): void;
}

/** A keyboard shortcut must not fire while the user is typing into something. */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const name = target.tagName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable;
};

/**
 * The active tool of one tab. Local state, like the selection is: what mode my
 * pointer is in is not board content, and a colleague changing theirs must not
 * change mine.
 *
 * Two things happen by themselves:
 * - a board that stops taking edits is put back to Select (a tool that writes on
 *   a board that cannot be written to is a button that looks broken);
 * - `Escape` leaves any tool for Select, which also abandons a drag in flight,
 *   because the tool that was drawing unmounts and takes the drag with it.
 *
 * @param selection the tab's selection, which `toolCreated` puts the new object in
 * @param canEdit   whether this board takes edits (see `canEdit`)
 */
export function useActiveTool(
  selection?: UseSelectionResult,
  canEdit = true,
): ActiveTool {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback((next: ToolId) => {
    // The board cannot show a tool it does not have; an unknown letter is not
    // even a tool, and it leaves the mode alone rather than going somewhere odd.
    if (!isAvailableTool(next)) return;
    setToolState(next);
  }, []);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    if (!isShapeKind(kind)) return;
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      selection?.click(id);
      setToolState('select');
    },
    [selection],
  );

  // A board that has stopped taking edits has no writing tool to be in.
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'Escape') {
        setToolState('select');
        return;
      }
      const named = toolForShortcut(event.key);
      if (named === undefined || !isAvailableTool(named)) return;
      // A board that will not take edits has no writing tool to enter: the letter is
      // spent on nothing rather than putting the person in a mode where every click
      // fails. Select is always enterable - it writes nothing.
      if (!canEditRef.current && named !== 'select') return;
      // The letter belongs to a tool, so it is not a letter typed at the board:
      // `i` is the Image tool and not a way to start a search for "i".
      event.preventDefault();
      setToolState(named);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return useMemo<ActiveTool>(
    () => ({ tool, shapeKind, setTool, setShapeKind, toolCreated }),
    [tool, shapeKind, setTool, setShapeKind, toolCreated],
  );
}

export default useActiveTool;
