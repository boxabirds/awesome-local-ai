// useActiveTool (story 10, tools.active_tool contract): the active tool of
// the board. Replaces the story 7 useTool (which only knew select/text).
//
//  - Toolbar clicks and single-letter shortcuts (v, n, t, s, l) set the tool.
//    Shortcuts are ignored while the user is typing in an editor (the text
//    caret owns the key) or while a modifier key is held (Ctrl+N etc. stay
//    browser commands).
//  - 'n' (sticky) is an action, not a tool: it creates a sticky at the board
//    centre and the tool is unchanged (story 9 behaviour).
//  - 'p', 'i' and 'c' are reserved for stories 11–12 and 17; this build
//    ignores them (unknown shortcuts are ignored, per the contract).
//  - Escape returns to Select from any tool, including an unfinished drag
//    (creating nothing); from Select it only clears the selection (story 7).
//  - toolCreated(id) selects the new object and returns to Select
//    (tools.return_to_select). The Pen tool never calls toolCreated: it stays
//    active after every finished stroke (pen.stay_active).

import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
};

/** The tools this build renders a gesture/UI for (stories 12, 17 unbuilt). */
const IMPLEMENTED_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  'text',
  'shape',
  'connector',
  'pen',
]);

export interface ActiveToolApi {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Select `id` as the only selection and switch back to Select. */
  toolCreated(id: string): void;
}

export interface UseActiveToolOptions {
  /** Story 4 edit lock: shape/connector/text tools need it. */
  canEdit: boolean;
  /** True while the user is typing in an editor (shortcuts go to the caret). */
  isEditing?(): boolean;
  /** Select `id` as the only selection. */
  onSelect(id: string): void;
  /** The 'n' shortcut (story 9): create a sticky at the board centre. */
  onCreateStickyAtCenter?(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable ||
    tag === 'SELECT'
  );
}

export function useActiveTool(opts: UseActiveToolOptions): ActiveToolApi {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(SHAPE_KINDS[0]);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setTool = useCallback((t: ToolId) => {
    if (!IMPLEMENTED_TOOLS.has(t)) return; // reserved for later stories
    if (
      (t === 'shape' || t === 'connector' || t === 'text' || t === 'pen') &&
      !optsRef.current.canEdit
    ) {
      return; // locked board
    }
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.onSelect(id);
    setToolState('select');
  }, []);

  // A locked board falls back to Select (story 4).
  useEffect(() => {
    if (!opts.canEdit && tool !== 'select') setToolState('select');
  }, [opts.canEdit, tool]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (optsRef.current.isEditing?.()) return;
      if (e.key === 'Escape') {
        // tools.return_to_select: Escape from Shape/Connector cancels the
        // tool (an unfinished drag is dropped) and creates nothing.
        setToolState('select');
        return;
      }
      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (t === undefined) return; // unknown shortcut: ignored
      if (t === 'sticky') {
        if (optsRef.current.canEdit) optsRef.current.onCreateStickyAtCenter?.();
        return;
      }
      if (!IMPLEMENTED_TOOLS.has(t)) return;
      if (
        (t === 'shape' || t === 'connector' || t === 'text' || t === 'pen') &&
        !optsRef.current.canEdit
      ) {
        return;
      }
      setToolState(t);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
