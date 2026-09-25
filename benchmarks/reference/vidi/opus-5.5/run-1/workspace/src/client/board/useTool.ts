import { SELECT_TOOL_LABEL, TEXT_TOOL_LABEL, useActiveTool, type ToolId } from '../tools/useActiveTool';

/** The active tool (story 9; story 10 moved it to tools/useActiveTool.ts). */
export type Tool = ToolId;

export { SELECT_TOOL_LABEL, TEXT_TOOL_LABEL };

/** Story 9's tool hook: the active tool only (see useActiveTool for the shape kind and return to Select). */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const { tool, setTool } = useActiveTool({ canEdit });
  return { tool, setTool };
}
