// Story 9: the per-client tool mode (anchor: text.tool_ui).
//
// A minimal `select | text` state; stories 10-12 extend the union. The state
// is per-client UI state (not persisted). While `text` is active:
//  - the board shows a text cursor and a click creates text there;
//  - the Text toolbar button is pressed;
//  - empty-space presses neither pan nor marquee (BoardViewport).
// `canEdit` false (load_failed) disables the Text tool: T is ignored, the
// button is disabled, and an active Text tool reverts to Select.

import { useCallback, useEffect, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolApi {
  tool: Tool;
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');

  // A board that loses editability (load_failed) reverts to Select
  // (text.not_editable); the Text tool is unavailable while read-only.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback(
    (next: Tool): void => {
      // text.not_editable: T (or a programmatic set) is ignored read-only.
      if (next === 'text' && !canEdit) return;
      setToolState(next);
    },
    [canEdit],
  );

  return { tool, setTool };
}
