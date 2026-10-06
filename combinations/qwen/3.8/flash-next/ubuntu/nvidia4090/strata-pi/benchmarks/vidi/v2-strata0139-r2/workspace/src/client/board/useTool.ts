import { useCallback, useEffect, useState } from "react";

/**
 * The board's active tool (`tool.mode`).
 *
 * A board is either in Select (pressing an object selects it, dragging pans) or
 * in Text (the next click on the board writes text there and the tool returns to
 * Select). Stories 10-12 add their tools to the same state; nothing else about
 * the board changes when the tool changes.
 *
 * The shortcuts themselves are handled in `useBoardKeys` (V, T, N, Escape), the
 * buttons in `Toolbar`, and the click in `BoardViewport`. All three go through
 * this one state, so the tool can only ever be what one place says it is.
 *
 * `canEdit` (story 4) closes the Text tool: a board that could not be loaded has
 * nothing to write, so asking for the Text tool is ignored and the tool is put
 * back to Select when the board stops being editable.
 */

export type Tool = "select" | "text";

export interface ToolApi {
  readonly tool: Tool;
  setTool(tool: Tool): void;
  /** True while the Text tool is waiting for its click. */
  readonly textActive: boolean;
}

export function useTool(canEdit: boolean): ToolApi {
  const [tool, setToolState] = useState<Tool>("select");

  const setTool = useCallback(
    (next: Tool) => {
      const target: Tool = next === "text" ? "text" : "select";
      if (target === "text" && !canEdit) return;
      setToolState((previous) => (previous === target ? previous : target));
    },
    [canEdit],
  );

  useEffect(() => {
    setToolState((previous) => (previous === "select" ? previous : "select"));
  }, [canEdit]);

  return { tool, setTool, textActive: tool === "text" };
}
