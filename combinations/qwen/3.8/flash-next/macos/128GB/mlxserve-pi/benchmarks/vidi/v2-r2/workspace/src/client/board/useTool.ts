// Which tool the pointer holds (story 9). Today there are two: Select, which is
// the board as stories 1-8 drew it, and Text, which places words where they are
// clicked. Stories 10-12 add shapes to the same state, which is why the tool is a
// name in a hook rather than a boolean on the page.
//
// This hook owns the state and nothing else. The keys are bound in useBoardKeys -
// V for Select, T for Text, N for a sticky note, Escape back to Select - because
// that hook already owns the one window keydown listener and the guard that keeps
// every keystroke the caret has away from the board. A listener per hook would
// have to duplicate that guard, and a key that fires while the user is typing is
// exactly the bug story 2 already had to fix once.
//
// A tool is a state of the screen, never of the document: nothing here is
// persisted, nothing here reaches another client. A board that cannot be edited
// has no tools to hold, so setting one does nothing and holding one is not
// allowed to survive the board becoming uneditable.

import { useCallback, useEffect, useState } from 'react';

/** The tools this build ships. Stories 10-12 extend this. */
export type Tool = 'select' | 'text';

export interface ToolState {
  tool: Tool;
  /** Ignored while the board cannot be edited; a board always keeps Select. */
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool): void => {
      if (!canEdit) return;
      setToolState(next);
    },
    [canEdit],
  );

  // A board that stops being editable mid-session - the room lost it, the link
  // went - cannot be left holding a tool that would do nothing with the next
  // click. Select is the state that says "nothing is being placed".
  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  return { tool, setTool };
}

/** The tool a key names, or null when the key names no tool. */
export function toolForKey(key: string): Tool | null {
  if (key === 'v' || key === 'V') return 'select';
  if (key === 't' || key === 'T') return 'text';
  return null;
}
