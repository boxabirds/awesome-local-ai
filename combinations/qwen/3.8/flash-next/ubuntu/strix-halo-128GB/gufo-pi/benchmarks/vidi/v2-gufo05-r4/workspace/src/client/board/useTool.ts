/**
 * Which tool the board's pointer is using (`text.tool`).
 *
 * Story 9 gives the board its first tool with a mode — the Text tool, which waits for a
 * click and places text where it lands — where story 2's sticky note button simply made a
 * note straight away. Two things follow, and both are why this is a hook of its own
 * rather than a `useState` in the board screen:
 *
 *  - the tool is **local**. Nobody else needs to know that you are holding the text tool:
 *    it changes nothing on the board until you click, and what it then changes arrives as
 *    an ordinary document update. So this state is not in `Y.Doc`, is not synced, and is
 *    not persisted — a refresh returns the pointer to Select.
 *  - the tool is **read by four places**: the toolbar (which button is lit), the viewport
 *    (the cursor, and what a click means), the keyboard (V, T, Escape) and the board
 *    screen (which starts editing whatever the click created). Stories 10 to 12 add their
 *    tools to the same union.
 *
 * A tool that cannot be used is not offered: on a board that failed to load there is
 * nothing to place, so the Text tool cannot be entered and is left the moment the board
 * stops being writable (`text.limit_access`).
 */

import { useCallback, useEffect, useState } from 'react';

/** The tool the pointer is holding. Later stories extend this list. */
export type Tool = 'select' | 'text';

export interface ToolControls {
  /** The active tool. `select` is the board's resting state. */
  tool: Tool;
  /** Choose a tool. Asking for one the board cannot offer leaves the tool as it was. */
  setTool(tool: Tool): void;
}

export function useTool(canUseTools: boolean): ToolControls {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool) => {
      setToolState(canUseTools ? next : 'select');
    },
    [canUseTools]
  );

  // A board that stops being writable mid-click stops offering the tool that writes:
  // the lit button and what the pointer can do have to agree.
  useEffect(() => {
    if (!canUseTools) setToolState('select');
  }, [canUseTools]);

  return { tool, setTool };
}
