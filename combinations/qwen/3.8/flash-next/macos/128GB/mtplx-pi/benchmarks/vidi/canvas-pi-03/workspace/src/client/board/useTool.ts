import { useCallback, useState } from 'react';
import { toolForKey, type Tool } from './tools';

export type { Tool };

export interface ToolState {
  /** The board's active tool. `'select'` unless the Text tool was armed. */
  tool: Tool;
  /** Change the tool. Ignored while the board cannot be edited. */
  setTool(next: Tool): void;
  /**
   * Feed a keydown to the tool layer: `T` arms the Text tool, `V`/`Escape`
   * disarm it. Returns true when the key was a tool shortcut (the caller then
   * stops handling that key). A board that cannot be edited never changes
   * tool, and a key combination with Ctrl/Cmd/Alt is never a shortcut.
   */
  fromKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean;
}

/**
 * The board's tool state (story 9, contract `text.tool`).
 *
 * A tool belongs to the board and to one client only: it is never written to
 * the Y.Doc, and a board that failed to load cannot arm one. Arming the Text
 * tool creates nothing by itself — the pointer does that — so the state is
 * deliberately tiny: one string plus the two rules that guard it.
 */
export function useTool(canEdit: boolean): ToolState {
  const [tool, set] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool) => {
      // A read-only board has no tools: an armed Text tool must fall back to
      // Select rather than sit there waiting for a click that cannot happen.
      if (!canEdit) {
        set('select');
        return;
      }
      set(next);
    },
    [canEdit],
  );

  const fromKey = useCallback(
    (event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }) => {
      const next = toolForKey(event);
      if (next === null) return false;
      if (!canEdit) return false;
      set(next);
      return true;
    },
    [canEdit],
  );

  return { tool, setTool, fromKey };
}
