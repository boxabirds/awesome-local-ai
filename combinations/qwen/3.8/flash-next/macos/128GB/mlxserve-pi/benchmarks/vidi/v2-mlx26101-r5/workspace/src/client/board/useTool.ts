/**
 * Which tool the pointer is: the one that picks things up, or the one that writes.
 *
 * Until story 9 the board had one tool and did not need to say so — the pointer selected, dragged and
 * panned, and there was nothing else for it to be. Text is the first thing that needs the pointer to
 * *make* something where it is pointing instead, and that is a question a board cannot answer by guess:
 * clicking on an empty board has to mean either "start a marquee" or "put some text here", and the only
 * way to tell which is to be told. Hence a tool, one at a time, shown in the toolbar and answered by
 * three keys.
 *
 * What the tool is *not*: it is not a mode the document knows about. It is this person's pointer, it is
 * not shared, it does not appear in the document, and nobody else's screen changes because they pressed
 * T. Two people on one board can be in different tools at the same moment, and that is not a conflict —
 * there is nothing to conflict about.
 *
 * Two rules hold it together:
 * — **one tool at a time**, and the tool never has to be turned off by anything but a choice: creating
 *   text with the Text tool leaves Select behind, because the next thing a person does with a pointer
 *   after placing a heading is nearly always something a pointer does anyway;
 * — **a board that cannot be written to has no writing tool**: the Text button is disabled and the Text
 *   tool cannot be entered, because offering a tool that would fail on its first click is worse than a
 *   button that says it cannot be used.
 */

import { useCallback, useEffect, useState } from 'react';

/** The tools this build has. A later story adds its own name here and the toolbar's button next to it. */
export type Tool = 'select' | 'text';

export interface ToolControls {
  /** The tool a pointer on the board is currently in. */
  tool: Tool;
  /**
   * Makes `tool` the active one — except `text` on a board that cannot be written to, which is refused
   * rather than entered and failed in.
   */
  setTool(tool: Tool): void;
}

/**
 * The board's tool state, and the rule that keeps it honest when the board stops being editable.
 *
 * `canEdit` is passed in rather than looked up here because it is the board's answer to whether this
 * person may write, and it can change underneath a person who is already standing in a tool: a board
 * that stops loading while the Text tool is lit has to put that light out, because the next click would
 * otherwise promise a text object that can never be written.
 */
export function useTool(canEdit: boolean): ToolControls {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool) => {
      if (next === 'text' && !canEdit) return;
      setToolState(next);
    },
    [canEdit],
  );

  useEffect(() => {
    if (!canEdit) setToolState((current) => (current === 'text' ? 'select' : current));
  }, [canEdit]);

  return { tool, setTool };
}
