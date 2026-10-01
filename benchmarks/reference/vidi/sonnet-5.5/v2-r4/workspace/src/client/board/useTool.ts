import { useActiveTool, type Tool } from '../tools/useActiveTool';

export type { Tool };

/** The active board tool (see `useActiveTool`); creating tools need an editable board. */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const { tool, setTool } = useActiveTool({ canEdit });
  return { tool, setTool };
}
