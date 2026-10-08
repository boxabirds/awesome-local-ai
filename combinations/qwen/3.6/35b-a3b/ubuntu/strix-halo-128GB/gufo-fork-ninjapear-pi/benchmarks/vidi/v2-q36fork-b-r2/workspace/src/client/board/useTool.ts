import * as React from 'react';

export type Tool = 'select' | 'text';   // stories 10-12 extend

export function useTool(canEdit: boolean): {
  tool: Tool;
  setTool(t: Tool): void;
} {
  const [tool, setTool] = React.useState<Tool>('select');

  // When canEdit turns false, active Text reverts to Select
  React.useEffect(() => {
    if (!canEdit && tool === 'text') {
      setTool('select');
    }
  }, [canEdit, tool]);

  return { tool, setTool };
}
