/**
 * Which tool the pointer is: select, or place text (`text.tool_ui`).
 *
 * A tool is a mode, not a command: pressing T changes what the *next click on the
 * board* means, and nothing else. So this is one piece of state, held where the
 * board can see it, with the two rules the PRD asks for:
 *
 * - **A board that cannot be written has no tools.** `canEdit` is false when the
 *   document failed to load or the connection is read-only: T is ignored, the Text
 *   button is disabled, and a Text tool that was already armed goes back to Select
 *   on its own — otherwise the board would offer a click that does nothing, which
 *   is worse than saying it cannot (the same shape story 7 gave the keyboard).
 * - **It is not text, and not a field.** Leaving the tool is what V and Escape are
 *   for; `useBoardKeys` decides that, and this hook only holds the answer.
 *
 * Story 10 to 12 add their own tools to this union; nothing else has to change.
 */
import { useCallback, useEffect, useState } from 'react';

/** What a click on the board does. `'select'` is the resting state. */
export type Tool = 'select' | 'text';

export interface ToolHandle {
  tool: Tool;
  /** Arm a tool. Asking for Text on a board that cannot be written is refused. */
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolHandle {
  const [tool, chooseTool] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool) => {
      // Refused rather than remembered: a board that cannot be written must not be
      // sitting in a mode whose clicks go nowhere when the connection comes back.
      if (next === 'text' && !canEdit) return;
      chooseTool(next);
    },
    [canEdit],
  );

  // The connection dropped, or the document failed to load, while Text was armed.
  useEffect(() => {
    if (!canEdit) chooseTool('select');
  }, [canEdit]);

  return { tool, setTool };
}
