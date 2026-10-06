/**
 * The board's tool mode (story 9).
 *
 * Two tools: **Select** (move, resize, marquee - everything stories 2 and 7 built) and **Text**
 * (click anywhere on the board to write there). The tool is per-screen state: it is not written to
 * the document, so two people on the same board each have their own tool.
 *
 * The keyboard and the toolbar both change it, and the viewport reads it to decide what a click
 * on the board means - so it lives above them both, in `Board`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export type Tool = 'select' | 'text';

export interface ToolController {
  readonly tool: Tool;
  /** Switching to Text on a board that cannot be edited is the caller's business, not this one's. */
  setTool(tool: Tool): void;
}

export function useTool(canEdit: boolean): ToolController {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback((next: Tool) => {
    setToolState(next);
  }, []);

  // A board that cannot be edited offers no Text tool: whoever holds it is put back on Select,
  // so a click there does the ordinary Select thing instead of silently doing nothing.
  useEffect(() => {
    if (canEdit) return;
    setToolState((current) => (current === 'text' ? 'select' : current));
  }, [canEdit]);

  return useMemo(() => ({ tool, setTool }), [tool, setTool]);
}
