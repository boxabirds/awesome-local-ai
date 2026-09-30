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
// Story 10 moved those rules into `../tools/useActiveTool`, where the Shape and
// Connector tools can share them: the state, the "a tool that cannot be used is not
// held" rule and the return to Select after a tool has drawn something are one thing
// now. This is the same door story 9's board and tests come in through, with the two
// tools it knows about.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { useMemo } from 'react';
import {
  TOOL_SELECT,
  TOOL_TEXT,
  useActiveTool,
  type ToolId,
} from '../tools/useActiveTool';

export { TOOL_SELECT, TOOL_TEXT };

export type Tool = ToolId;

export interface ToolMode {
  tool: Tool;
  /** `select` and `text` switch; anything else (story 1's `sticky`) goes to select. */
  setTool(tool: string): void;
}

export function useTool(canEdit: boolean): ToolMode {
  const { tool, setTool } = useActiveTool({ canEdit });
  return useMemo<ToolMode>(
    () => ({ tool, setTool: (tool: string): void => setTool(tool as ToolId) }),
    [tool, setTool],
  );
}
