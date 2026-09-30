import { useActiveTool, type ToolId } from '../tools/useActiveTool';

/** The active board tool (story 9); story 10 moved it to `tools/useActiveTool`. */
export type Tool = ToolId;

export interface ToolApi {
  tool: Tool;
  setTool(t: Tool): void;
}

/** Story 9's hook, kept for existing callers: the active tool without shape kind or creation. */
export function useTool(canEdit: boolean): ToolApi {
  const { tool, setTool } = useActiveTool({ canEdit });
  return { tool, setTool };
}
