import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  SHAPE_FILL_NAMES,
  SHAPE_KINDS,
  SHAPE_STROKE_NAMES,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from "../../shared/config";

/**
 * The board's active tool (`tools.active_tool`).
 *
 * Story 9's Select/Text pair plus this story's Shape and Connector. One state,
 * shared by the toolbar buttons, the keyboard and the board's pointer handling,
 * so the tool can only ever be what one place says it is.
 *
 * `pen`, `image` and `comment` are in the type and in the shortcut table because
 * the story 10 design lists them — `pen` is story 11's tool, which stays armed
 * after it has drawn, and `image` (story 12) and `comment` are actions rather than
 * modes: arming `image` opens the file picker and hands the board straight back to
 * Select. Every other tool
 * is not survived by creating its object: `toolCreated(id)` selects what was made
 * and hands the board back to Select, which is what makes moving things afterwards a
 * click on the object rather than a fight with the tool that made it.
 */

export type ToolId = "select" | "sticky" | "text" | "shape" | "connector" | "pen" | "image" | "comment";

/** One letter each, and they are tools, not menus — there is no Ctrl+Shift+S. */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: "select",
  n: "sticky",
  t: "text",
  s: "shape",
  l: "connector",
  p: "pen",
  i: "image",
  c: "comment",
};

/** The tool a key means, or `undefined` for a key that names no tool. Case-insensitive. */
export function toolForShortcut(key: string): ToolId | undefined {
  const tool = TOOL_SHORTCUTS[key.toLowerCase()];
  return tool === undefined ? undefined : tool;
}

export interface ActiveToolOptions {
  /** False when this board could not be loaded: a tool that writes is not offered. */
  canEdit?: boolean;
  /** Selects an object the board has just created (`toolCreated`). */
  select?(id: string): void;
}

export interface ActiveToolApi {
  readonly tool: ToolId;
  /** The shape kind the next shape is drawn as. */
  readonly shapeKind: ShapeKind;
  /** The fill and stroke subsequently created shapes start with. */
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  setFill(fill: FillColor): void;
  setStroke(stroke: StrokeColor): void;
  /** What was just created is selected, and the board is back in Select. */
  toolCreated(id: string): void;
}

/** Tools this board has a tool component for; the rest are accepted and ignored. */
const AVAILABLE_TOOLS: readonly ToolId[] = ["select", "sticky", "text", "shape", "connector", "pen", "image"];

export function useActiveTool(options: ActiveToolOptions = {}): ActiveToolApi {
  const { canEdit = true, select } = options;
  const [tool, setToolState] = useState<ToolId>("select");
  const [shapeKind, setShapeKindState] = useState<ShapeKind>("rect");
  const [fill, setFillState] = useState<FillColor>(DEFAULT_SHAPE_FILL);
  const [stroke, setStrokeState] = useState<StrokeColor>(DEFAULT_SHAPE_STROKE);

  const setTool = useCallback(
    (next: ToolId) => {
      // A tool that would write to a board this tab may not write to is ignored;
      // going back to Select always works.
      if (next !== "select" && !canEdit) return;
      setToolState((previous) => (previous === next ? previous : next));
    },
    [canEdit],
  );

  // A board that stops being editable is a board nobody can draw on.
  useEffect(() => {
    setToolState((previous) => (previous === "select" ? previous : "select"));
  }, [canEdit]);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    if (!SHAPE_KINDS.includes(kind)) return;
    setShapeKindState((previous) => (previous === kind ? previous : kind));
  }, []);

  const setFill = useCallback((next: FillColor) => {
    if (!SHAPE_FILL_NAMES.includes(next)) return;
    setFillState((previous) => (previous === next ? previous : next));
  }, []);

  const setStroke = useCallback((next: StrokeColor) => {
    if (!SHAPE_STROKE_NAMES.includes(next)) return;
    setStrokeState((previous) => (previous === next ? previous : next));
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      if (typeof id !== "string" || id.length === 0) return;
      select?.(id);
      setToolState("select");
    },
    [select],
  );

  return { tool, shapeKind, fill, stroke, setTool, setShapeKind, setFill, setStroke, toolCreated };
}

/** True when some part of this board handles the tool. */
export function isAvailableTool(tool: ToolId): boolean {
  return AVAILABLE_TOOLS.includes(tool);
}
