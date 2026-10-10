import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, TOOL_SHORTCUTS, type ShapeKind } from '../../shared/config';

/**
 * Which tool this client is holding (anchor `tool.shortcuts`, `tool.return`).
 *
 * Story 8's `useTool` held two tools; story 10 names the whole set the app will
 * grow into and owns the state for the ones that exist today. The union is the
 * cross-story convention - `sticky`, `image` and `comment` are named here because
 * `TOOL_SHORTCUTS` in `src/shared/config.ts` names them, and a tool that does not
 * exist yet is a name nothing can arm (Key decision 5): a board cannot be holding a
 * tool nothing has built a drawing for, so asking for one leaves the tool as it was.
 *
 * Story 11 arms the one tool story 10 left unarmmed: `pen` (P) draws freehand, and
 * unlike every other tool it **stays in hand** after it has made something
 * (`pen.stay_active`), so `toolCreated` - which is what puts a tool back to Select -
 * is never called for a stroke. Nothing here writes the document. Like
 * `useTool`, this hook holds no `Y.Doc`: the tools (`ShapeTool`, `ConnectorTool`,
 * `PenTool`) and `BoardView`'s existing Text creation do the writing, and
 * `toolCreated` is how the ones that return report back.
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> select
 *     select --> shape : S or the Shape button
 *     select --> connector : L or the Connector button
 *     select --> pen : P or the Pen button
 *     shape --> select : Escape, V, or a created shape (tool.return)
 *     connector --> select : Escape, L re-pressed is a no-op, or a created connector
 *     shape --> connector : I while the Shape tool is held
 *     pen --> pen : a finished stroke (`pen.stay_active`)
 *     pen --> select : Escape or V
 *     select --> select : canEdit becomes false (`text.tool_ui`, TC-15)
 * ```
 */

/** Every tool id the app has a name for. Stories 13-17 fill in the rest. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** The tools this board can actually arm (`tool.shortcuts`). */
export const ARMLED_TOOL_IDS: readonly ToolId[] = ['select', 'text', 'shape', 'connector', 'pen'];

/**
 * Keys `useBoardKeys` answers (`v`, `t`, `n`): V and Escape return to Select, T
 * arms the Text tool and N creates a sticky note at the centre of the view
 * (`text.tool_ui`, TC-18). The tool hook takes the letters nobody else has.
 */
const BOARD_OWNED_KEYS: readonly string[] = ['v', 't', 'n'];

export interface ActiveTool {
  readonly tool: ToolId;
  /** Which shape the Shape tool will draw (`shape.kind`). */
  readonly shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** A tool created `id`: it becomes the selection and the tool goes back to Select. */
  toolCreated(id: string): void;
}

export interface ActiveToolInput {
  /** False on a board this client may not edit: no creation tool can be held (TC-15). */
  readonly canEdit?: boolean;
  /**
   * Something on the board is being typed into. A letter is then a letter, not a
   * tool shortcut (`text.tool_ui`, TC-16) - the same rule `useBoardKeys` applies,
   * read from the same selection so the two cannot disagree.
   */
  readonly editing?: boolean;
  /** `useSelection`'s click-select, used by `toolCreated`. */
  readonly select?: (ids: readonly string[]) => void;
}

const DEFAULT_SHAPE_KIND: ShapeKind = SHAPE_KINDS[0];

export function useActiveTool(input: ActiveToolInput = {}): ActiveTool {
  const { canEdit = true, editing = false, select } = input;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  // The inputs `select` arrives as a fresh closure on every render, so the
  // handlers below read it through a ref and keep their identity - like every
  // other board hook in this app.
  const selectRef = useRef(select);
  selectRef.current = select;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const setTool = useCallback(
    (next: ToolId): void => {
      if (!ARMLED_TOOL_IDS.includes(next)) {
        return; // a tool with no implementation cannot be armed
      }
      // A board this client may not edit cannot hold a creation tool (TC-15).
      setToolState(canEdit || next === 'select' ? next : 'select');
    },
    [canEdit],
  );

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    if ((SHAPE_KINDS as readonly string[]).includes(kind)) {
      setShapeKindState(kind);
    }
  }, []);

  /**
   * `tool.return`: the object a tool made becomes the selection - the new
   * object's toolbar is then available at once - and the tool is put back, so the
   * next click is a normal board click rather than a second object (TC-22).
   */
  const toolCreated = useCallback((id: string): void => {
    if (typeof id === 'string' && id !== '') {
      selectRef.current?.([id]);
    }
    setToolState('select');
  }, []);

  // A tool held when the board is taken away goes back to Select (`text.tool_ui`).
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  // The single-letter tool shortcuts (`tool.shortcuts`). V, T and N belong to
  // `useBoardKeys`, which also ends editing and clears the selection around them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      ) {
        return; // typing a letter is typing, not choosing a tool (TC-16)
      }
      if (editingRef.current) {
        return; // the board is typing into something (`text.tool_ui`, TC-16)
      }
      const key = event.key.toLowerCase();
      if (BOARD_OWNED_KEYS.includes(key)) {
        return;
      }
      const next = (TOOL_SHORTCUTS as Record<string, ToolId>)[key];
      if (!next || !ARMLED_TOOL_IDS.includes(next)) {
        return;
      }
      event.preventDefault();
      setTool(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
