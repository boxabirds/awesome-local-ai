import { useCallback, useEffect, useState } from 'react';

/**
 * The tools the left toolbar offers. `select` is the board as stories 1–8 knew it;
 * `text` is the story 9 Text tool. Stories 10–12 add their own tools here rather
 * than inventing a second tool mechanism.
 */
export type Tool = 'select' | 'text';

export interface ToolState {
  readonly tool: Tool;
  setTool(tool: Tool): void;
}

/**
 * Which tool is active, per tab (never shared through the document).
 *
 * A tool that cannot be used is not kept: when the board stops being editable —
 * it failed to load — an active Text tool falls back to Select, so the board never
 * sits in a mode where a click would create something the person cannot have
 * (PRD text.load_failed).
 */
export function useTool(canEdit: boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback(
    (next: Tool) => {
      setToolState((prev) => (next === 'text' && !canEdit ? prev : next));
    },
    [canEdit],
  );

  return { tool, setTool };
}
