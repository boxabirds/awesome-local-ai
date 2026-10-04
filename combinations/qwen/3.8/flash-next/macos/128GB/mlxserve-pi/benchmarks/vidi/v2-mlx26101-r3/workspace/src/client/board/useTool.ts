import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What a press on the board is for.
 *
 * Two, because that is what this story asks for: an ordinary pointer that selects and moves, and a
 * pointer that writes. Everything else on the board - notes, text, selection, moving - is done with
 * the first one, and the second exists only long enough to put one piece of text down.
 */
export type Tool = 'select' | 'text';

export interface BoardTool {
  tool: Tool;
  /** Ask for a tool. A board that cannot be written to will not take one that writes. */
  setTool(tool: Tool): void;
}

/**
 * The board's one tool control.
 *
 * A tool is not stored on the board, and it is not shared: it is this person's mouse, on this
 * screen, for the moment. Putting it in the document would tell everybody else that somebody here
 * is about to type, and would put a piece of state that only means anything to one person where
 * five people would have to agree about it - which is what the selection already is not, for the
 * same reason.
 *
 * The one rule it has is that a board which cannot be written to cannot be in a tool that writes.
 * When a board fails to load, or stops being editable, the Text tool is dropped - not because a
 * person chose Select, but because the choice they made is no longer a thing that can be honoured,
 * and leaving the button pressed while every click does nothing is a lie about the state of the
 * board. A tool that cannot be given is not silently swallowed either: the caller is told nothing
 * happened by the fact that `tool` did not change, which is what the toolbar's pressed state reads.
 */
export function useTool(canEdit: boolean): BoardTool {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  });

  const setTool = useCallback((next: Tool): void => {
    if (next === 'text' && !canEditRef.current) {
      // A board that cannot be written to has no Text tool to offer, and a tool button that lights
      // up and then does nothing is worse than one that never looks pressed at all.
      setToolState('select');
      return;
    }
    setToolState(next);
  }, []);

  useEffect(() => {
    if (!canEdit) {
      // The board went uneditable while a tool was up - the connection failed, the board was
      // taken away. The tool follows the board, not the other way round.
      setToolState('select');
    }
  }, [canEdit]);

  return { tool, setTool };
}
