import { useCallback, useEffect, useState } from 'react';

/**
 * The tool this client is holding (anchor `text.tool_ui`).
 *
 * Select and Text, in memory only: which tool one person holds is not part of the
 * board, exactly like selection. Stories 10-12 extend the same state with their own
 * tools; nothing else in the app needs to know which tools exist.
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Select
 *     Select --> Text : T key or Text button with canEdit
 *     Text --> Select : Escape or V or Select button
 *     Text --> Select : board click creates text
 *     Text --> Select : canEdit becomes false
 * ```
 *
 * Creating the object is not this hook's job - `BoardView` calls `createText` when
 * the Text tool reports a click - so this hook holds no document and cannot write
 * one (TC-15: a board the room could not load never gets a Text tool).
 */

/** The tool this client is holding. Stories 10-12 extend this union. */
export type Tool = 'select' | 'text';

export interface ToolState {
  readonly tool: Tool;
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolState {
  const [tool, setTool] = useState<Tool>('select');

  // A board this client may not edit cannot be holding a creation tool (TC-15):
  // an active Text tool reverts to Select the moment `canEdit` goes false.
  useEffect(() => {
    if (!canEdit) {
      setTool((current) => (current === 'text' ? 'select' : current));
    }
  }, [canEdit]);

  const setToolGated = useCallback(
    (next: Tool): void => {
      setTool(next === 'text' && !canEdit ? 'select' : next);
    },
    [canEdit],
  );

  return { tool, setTool: setToolGated };
}
