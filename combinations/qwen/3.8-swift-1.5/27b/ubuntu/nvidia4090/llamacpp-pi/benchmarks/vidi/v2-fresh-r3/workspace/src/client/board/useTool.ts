import { createContext, useCallback, useEffect, useRef, useState } from 'react';

/** Board tools (story 9): `select` is the default; `text` arms board clicks to create text. */
export type Tool = 'select' | 'text';

/**
 * The active tool, readable by object components. In `text` mode objects render
 * pointer-transparent so a click anywhere (even over an object) creates text at
 * that point (text.tool). Read via `useContext(ToolContext)`.
 */
export const ToolContext = createContext<Tool>('select');

/**
 * Tool state (text.tool): starts at `select`, switches to `text` only when
 * `canEdit` (viewer role), and returns to `select` automatically when edit
 * rights are lost.
 */
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void } {
  const [tool, setToolState] = useState<Tool>('select');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  // Losing edit rights demotes the text tool (viewers never arm it).
  useEffect(() => {
    if (!canEdit && tool === 'text') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback((t: Tool) => {
    setToolState(t === 'text' && !canEditRef.current ? 'select' : t);
  }, []);

  return { tool, setTool };
}
