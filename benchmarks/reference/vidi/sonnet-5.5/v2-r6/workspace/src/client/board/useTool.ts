import { useActiveTool, type ToolId } from '../tools/useActiveTool';

export type Tool = ToolId;

/** The active board tool without shape state; see `useActiveTool`. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const { tool, setTool } = useActiveTool({ canEdit });
  return { tool, setTool };
}
