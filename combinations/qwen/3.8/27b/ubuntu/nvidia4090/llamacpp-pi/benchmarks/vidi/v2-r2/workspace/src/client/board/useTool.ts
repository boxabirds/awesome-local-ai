/**
 * The board's active tool (story 9, tool.*): 'select' (the default; select,
 * move, pan) or 'text' (a click on empty board creates a text object there).
 *
 * The text tool is only available while the board is editable
 * (board.readonly: a read-only board always uses the select tool). The
 * tool automatically reverts to 'select' when the board becomes read-only
 * (e.g. the local client is disconnected with no reconnect).
 */

import { useCallback, useEffect, useState } from 'react';

/** The board tools. 'select' is the default. */
export type Tool = 'select' | 'text';

export function useTool(canEdit: boolean): {
  tool: Tool;
  setTool(t: Tool): void;
} {
  const [tool, setToolState] = useState<Tool>('select');

  // A read-only board never uses the text tool (board.readonly).
  useEffect(() => {
    if (!canEdit && tool === 'text') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool): void => {
    setToolState(canEdit ? t : 'select');
  }, [canEdit]);

  return { tool, setTool };
}
