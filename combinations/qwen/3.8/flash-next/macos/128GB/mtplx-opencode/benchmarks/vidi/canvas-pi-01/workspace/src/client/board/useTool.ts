/**
 * Story 9 · task 6 — the board tool mode (design "Tool mode").
 *
 * A tiny per-client tool state — `select` or `text` — that decides what an
 * empty-space click does: pan/marquee/select (Select) or write a new text object
 * where I clicked (Text). Like selection it is never written to the `Y.Doc`; it
 * lives only in this tab. Stories 10–12 add their own tools to the same union.
 *
 * Two invariants the design calls out (state diagram "Per-client tool state"):
 *  - a Text tool that is no longer allowed (the board went read-only) reverts to
 *    Select;
 *  - the tool never blocks editing: `T` typed *inside* a text field is a
 *    character, not a tool switch (that is decided by the keyboard layer, which
 *    only calls `setTool` when nothing is focused).
 */
import { useCallback, useState } from 'react';

/** The tools the board currently offers. */
export type Tool = 'select' | 'text';

export interface ToolState {
  /** The active tool. */
  tool: Tool;
  /** Switch tools. Ignored when not allowed (a read-only board keeps Select). */
  setTool(tool: Tool): void;
}

/**
 * Hold the active tool. `canEdit` is read through a getter so a board that flips
 * to read-only drops an active Text tool immediately, without the tool ever
 * becoming settable again while editing is disabled.
 */
export function useTool(getCanEdit: () => boolean): ToolState {
  const [tool, setToolState] = useState<Tool>('select');

  const setTool = useCallback(
    (next: Tool) => {
      // Only Text can be blocked; Select is always available. A read-only board
      // never lets Text become active (TC-15).
      if (next === 'text' && !getCanEdit()) return;
      setToolState((prev) => (prev === next ? prev : next));
    },
    [getCanEdit],
  );

  return { tool, setTool };
}
