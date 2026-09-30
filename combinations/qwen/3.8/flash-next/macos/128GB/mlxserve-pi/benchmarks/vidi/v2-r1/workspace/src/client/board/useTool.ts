// Which tool the toolbar has picked (`tool_ui`, `text.consistent`).
//
// There are two places a click can go: to the selection, or to a new object. That
// is the whole difference between `select` and `text`, and it lives here rather
// than in a piece of state in Board — because the rules that go with it are rules
// about *the tool*, not about a click:
//
//   - leaving the text tool goes back to selecting, and the board behaves as if the
//     text tool had never been picked (TC-24);
//   - a board you cannot edit cannot hold the text tool at all: the button is
//     disabled, and a shortcut that arrives anyway does nothing (TC-30).
//
// The sticky note is not a mode. It is a one-shot button that makes a note and
// leaves the tool where it was, exactly as it was in story 1.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { useCallback, useEffect, useState } from 'react';

/** The tool the board is in when it is just selecting things. */
export const TOOL_SELECT = 'select';
/** The text tool: the next place you go puts plain text down there. */
export const TOOL_TEXT = 'text';

export type Tool = typeof TOOL_SELECT | typeof TOOL_TEXT;

export interface ToolMode {
  tool: Tool;
  /** `select` and `text` switch; anything else (story 1's `sticky`) goes to select. */
  setTool(tool: string): void;
}

export function useTool(canEdit: boolean): ToolMode {
  const [tool, setToolState] = useState<Tool>(TOOL_SELECT);

  const setTool = useCallback(
    (next: string): void => {
      if (next !== TOOL_SELECT && next !== TOOL_TEXT) {
        setToolState(TOOL_SELECT);
        return;
      }
      // Ctrl+T on a board you cannot edit does nothing at all — not even leave the
      // selection looking armed for a tool that cannot be used.
      if (next === TOOL_TEXT && !canEdit) {
        setToolState(TOOL_SELECT);
        return;
      }
      setToolState(next);
    },
    [canEdit],
  );

  // Being told you cannot edit while the text tool is up puts the board back the
  // way it was: read-only boards have no text tool to be in.
  useEffect(() => {
    if (!canEdit) setToolState(TOOL_SELECT);
  }, [canEdit]);

  return { tool, setTool };
}
