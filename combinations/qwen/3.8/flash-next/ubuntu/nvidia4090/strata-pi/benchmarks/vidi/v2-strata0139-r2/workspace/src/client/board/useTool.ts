import { useActiveTool } from "../tools/useActiveTool";
import type { ToolId } from "../tools/useActiveTool";

/**
 * The board's active tool (`tool.mode`).
 *
 * A board is either in Select (pressing an object selects it, dragging pans) or
 * in Text (the next click on the board writes text there and the tool returns to
 * Select). Stories 10-12 add their tools to the same state; nothing else about
 * the board changes when the tool changes.
 *
 * From story 10 on the state itself lives in `../tools/useActiveTool` — the tool
 * id, the shape kind and style, and the rule that creating an object hands the
 * board back to Select. This file is the Select/Text view story 9 was written
 * against: the same state, narrowed to the two tools story 9 knows, so the
 * viewport, the keyboard and the toolbar keep talking to one API.
 *
 * The shortcuts themselves are handled in `useBoardKeys` (V, T, N, Escape), the
 * buttons in `Toolbar`, and the click in `BoardViewport`. All three go through
 * this one state, so the tool can only ever be what one place says it is.
 *
 * `canEdit` (story 4) closes the writing tools: a board that could not be loaded
 * has nothing to write, so asking for a tool that writes is ignored and the tool
 * is put back to Select when the board stops being editable.
 */

export type Tool = ToolId;

export interface ToolApi {
  readonly tool: Tool;
  setTool(tool: Tool): void;
  /** True while the Text tool is waiting for its click. */
  readonly textActive: boolean;
}

export function useTool(canEdit: boolean): ToolApi {
  const active = useActiveTool({ canEdit });
  return { tool: active.tool, setTool: active.setTool, textActive: active.tool === "text" };
}
