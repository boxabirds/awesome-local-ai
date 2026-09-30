import { type ToolId, useActiveTool } from '../tools/useActiveTool';

/** The active board tool (story 9 name; story 10 moved it to `tools/useActiveTool`). */
export type Tool = ToolId;

/**
 * Active tool state (text.tool_ui): `useActiveTool` without shapes or selection.
 * Editing tools cannot be chosen while the board cannot be edited, and revert to Select.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const { tool, setTool } = useActiveTool({ canEdit });
  return { tool, setTool };
}
