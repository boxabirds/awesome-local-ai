/**
 * Which tool the pointer is right now (`src/client/board/useTool.ts`).
 *
 * The board has one pointer and several things a click could mean: move
 * something, select something, or *write* something. Story 9 is the first story
 * where a click on empty board space has to decide between two of those, so the
 * answer is kept here, in one place, as `select` or `text`.
 *
 * Two things about this state are the whole design:
 *
 * - **It is not board content.** What this person's pointer is set to is no more
 *   shared than what they have selected - story 7 put the selection outside the
 *   document for the same reason - so it is React state, per tab, and a colleague
 *   pressing T changes nothing here.
 * - **It is momentary.** The Text tool exists to answer one question - where does
 *   this text go? - and a click answers it, so placing text switches back to
 *   Select straight away. A tool that stayed active would turn every following
 *   click into another empty text object, which is not a mode anyone asked for.
 *   Stories 10-12 will add their tools to this same union and can each decide how
 *   long they last; sticky notes never became a tool at all (N creates one
 *   straight away, which is story 2's behaviour and stays that way).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

/** The tools this build has. Stories 10-12 extend the union. */
export type Tool = 'select' | 'text';

/** What {@link useTool} hands the board. */
export interface ToolControls {
  /** The active tool. */
  tool: Tool;
  /** Make `tool` the active one. Ignored by nothing: a read-only board is handled
   * by the effect below, which pulls an active Text back to Select. */
  setTool(tool: Tool): void;
}

/**
 * The active tool, and the one rule that goes with it: a board that will not take
 * edits has no text tool to be in. The toolbar greys the button out and the
 * shortcut ignores `T`, but a board that fails to load *while* the person is in
 * the Text tool would otherwise leave them in a mode whose every click does
 * nothing - so the tool comes back to Select on its own.
 */
export function useTool(canEdit: boolean): ToolControls {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((next: Tool): void => {
    setToolState(next);
  }, []);

  useEffect(() => {
    if (canEdit) return;
    setToolState((previous) => (previous === 'select' ? previous : 'select'));
  }, [canEdit]);

  return useMemo<ToolControls>(() => ({ tool, setTool }), [tool, setTool]);
}
