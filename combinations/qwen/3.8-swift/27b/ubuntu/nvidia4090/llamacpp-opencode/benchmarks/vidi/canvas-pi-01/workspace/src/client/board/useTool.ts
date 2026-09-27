// Active tool state (see spec: board.text_tool).
//
// 'select' is the default; 'text' is only reachable while editable. When the
// connection drops (offline → not editable) the tool reverts to 'select'
// immediately: the text tool must never stay active while the user cannot
// create anything (TC-17).

import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): { tool: Tool; setTool: (tool: Tool) => void } {
  const [tool, setTool] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit && tool !== 'select') setTool('select');
  }, [canEdit, tool]);

  const change = useCallback((next: Tool): void => {
    setTool(canEdit ? next : 'select');
  }, [canEdit]);

  return { tool, setTool: change };
}
