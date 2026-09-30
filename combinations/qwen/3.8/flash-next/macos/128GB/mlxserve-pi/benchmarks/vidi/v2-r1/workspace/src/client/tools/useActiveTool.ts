// Which tool is up, and what happens when it makes something (`tool_ui`,
// `tools.return_to_select`).
//
// Story 9 had two tools and kept this in `useTool`. Story 10 adds a Shape tool and a
// Connector tool, and with them the rule that every drawing tool shares: *the tool is
// put away the moment it has made the thing it draws*. A shape or an arrow you have
// just drawn is the thing you most want to adjust, and a tool that stayed up would
// make the next click another one of the same instead.
//
// The rules that live here, and nowhere else:
//
//   - a tool is a mode, so picking one is state and not an action. The sticky note is
//     the exception that was here first: `sticky` is the rail's one-shot button, and
//     asking for it leaves the board in Select, exactly as it was in story 1;
//   - a tool this build has no behaviour for is not a mode you can be stuck in either:
//     `image` and `comment` are the rail's shape, and asking for one selects;
//   - a board you cannot edit holds no tool at all, and a shortcut that arrives anyway
//     does nothing (TC-30's rule, kept from story 9 for every tool now);
// - the tool that created something hands the new object back as the selection, so
//     the thing it just drew is what the keyboard and the bar then act on;
//   - Escape leaves the tool and creates nothing (TC-22) — including halfway through a
//     drag, which the tool itself takes as its cue to throw its preview away.
//
// Story 11's Pen tool is the first tool that does *not* use the third rule: drawing one
// line with a pen does not mean you are done with the pen, so `PenTool` never calls
// `toolCreated` and stays up after every stroke (`pen.stay_active`). Nothing here needs to
// know that: staying up is simply never being put away, which is why the rule below is a
// callback the tool may or may not call rather than something this hook does for it.
//
// Spec: spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md
//       (tools.active_tool)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

/** Every tool the rail can show, whether or not this build draws it. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Selecting, moving, resizing: the board behaving as itself. */
export const TOOL_SELECT: 'select' = 'select';
/** The next place you go puts plain text down there. */
export const TOOL_TEXT: 'text' = 'text';
/** Drag a rectangle, ellipse or diamond, or click to drop one. */
export const TOOL_SHAPE: 'shape' = 'shape';
/** Drag from one object to another to join them with an arrow. */
export const TOOL_CONNECTOR: 'connector' = 'connector';
/** Draw freehand; stays up after every stroke, because a pen is not a stamp. */
export const TOOL_PEN: 'pen' = 'pen';
/** The rail's one-shot button, kept as a tool id so `N` means what it has always meant. */
export const TOOL_STICKY: 'sticky' = 'sticky';

/**
 * The single-letter shortcuts, keyed by the lower-case letter (`tools.active_tool`).
 * Story 9's `v`, `t` and `n` are here unchanged; `s` and `l` are this story's. The
 * letters that belong to tools no story has drawn are claimed already, so that a tool
 * added later does not have to move a key people have learned.
 */
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: TOOL_SELECT,
  n: TOOL_STICKY,
  t: TOOL_TEXT,
  s: TOOL_SHAPE,
  l: TOOL_CONNECTOR,
  p: TOOL_PEN,
  i: 'image',
  c: 'comment',
};

/**
 * The tools this build can actually be *in*. `sticky` is a button and not a mode, and
 * `image` and `comment` have no drawing code yet: asking for either leaves the board in
 * Select rather than in a mode that would do nothing. `pen` was in that list until story 11
 * drew it, and is a mode now (`pen.stay_active`): asking for it is asking to keep drawing.
 */
export const BUILT_TOOLS: readonly ToolId[] = [
  TOOL_SELECT,
  TOOL_TEXT,
  TOOL_SHAPE,
  TOOL_CONNECTOR,
  TOOL_PEN,
];

/** The kind the Shape tool draws next; the first of the menu's three. */
export const DEFAULT_SHAPE_KIND: ShapeKind = SHAPE_KINDS[0];

export interface ActiveToolOptions {
  /** False on a board that could not be loaded: no tool that writes may be held. */
  canEdit?: boolean;
  /** Make this object the selection — what the board does with a thing it just drew. */
  onSelect?(id: string): void;
  /**
   * The Image tool was asked for — by its rail button or the `i` shortcut. It is not a
   * mode you are ever *in*: asking for it opens the file picker and leaves the board in
   * Select, whether a file is then chosen or the picker is cancelled (`image.pick`).
   */
  onImagePicker?(): void;
}

export interface ActiveTool {
  tool: ToolId;
  /** Which shape the Shape tool draws (`shape.kind_menu`). */
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /**
   * The tool made something (TC-22): the new object becomes the only selection and the
   * active tool goes back to Select, so it can be adjusted at once.
   */
  toolCreated(id: string): void;
  /** Escape, and nothing else: leave the tool, create nothing. */
  reset(): void;
  /** The four questions the board asks about the tool, spelled out once. */
  isSelect: boolean;
  isText: boolean;
  isShape: boolean;
  isConnector: boolean;
  isPen: boolean;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveTool {
  const { canEdit = true, onSelect, onImagePicker } = options;
  const [tool, setToolState] = useState<ToolId>(TOOL_SELECT);
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  const setTool = useCallback(
    (next: ToolId): void => {
      // The Image tool is the rail's one-shot shape: it opens the picker and the board is
      // left in Select. A board you cannot edit gets neither the picker nor a tool.
      if (next === 'image') {
        if (canEdit) onImagePicker?.();
        setToolState(TOOL_SELECT);
        return;
      }
      // A tool with no behaviour here, and the sticky note's one-shot button, are both
      // answered the same way: the board is left in Select.
      if (!BUILT_TOOLS.includes(next)) {
        setToolState(TOOL_SELECT);
        return;
      }
      // Ctrl+T, Ctrl+S, Ctrl+L on a board you cannot edit do nothing at all — not even
      // leave a tool looking armed that nothing can be drawn with it.
      if (next !== TOOL_SELECT && !canEdit) {
        setToolState(TOOL_SELECT);
        return;
      }
      setToolState(next);
    },
    [canEdit, onImagePicker],
  );

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    // The menu offers the kinds and nothing else; a kind outside it is not a shape.
    if (!SHAPE_KINDS.includes(kind)) return;
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback(
    (id: string): void => {
      onSelect?.(id);
      setToolState(TOOL_SELECT);
    },
    [onSelect],
  );

  const reset = useCallback((): void => {
    setToolState(TOOL_SELECT);
  }, []);

  // Being told you cannot edit puts the board back the way it was: a board that cannot
  // be written on has no drawing tool to be in.
  useEffect(() => {
    if (!canEdit) setToolState(TOOL_SELECT);
  }, [canEdit]);

  return useMemo<ActiveTool>(
    () => ({
      tool,
      shapeKind,
      setTool,
      setShapeKind,
      toolCreated,
      reset,
      isSelect: tool === TOOL_SELECT,
      isText: tool === TOOL_TEXT,
      isShape: tool === TOOL_SHAPE,
      isConnector: tool === TOOL_CONNECTOR,
      isPen: tool === TOOL_PEN,
    }),
    [tool, shapeKind, setTool, setShapeKind, toolCreated, reset],
  );
}
