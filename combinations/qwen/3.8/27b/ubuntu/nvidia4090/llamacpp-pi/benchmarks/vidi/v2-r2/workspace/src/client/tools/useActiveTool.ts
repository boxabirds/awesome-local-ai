/**
 * The board's active tool (story 10, tools.active_tool): one tool id at a
 * time — 'select' (the default; select, move, pan) plus the creation tools.
 *
 * Story 10 adds the Shape and Connector tools and the `shapeKind` the Shape
 * tool draws with. 'sticky', 'pen', 'image' and 'comment' are reserved
 * ids: 'sticky' is a momentary tool (its shortcut N and the toolbar button
 * create a note at the view centre and the tool never stays active — the
 * story 9 behaviour), and the rest are not implemented yet (their
 * shortcuts are known but ignored).
 *
 * - Single-letter shortcuts arm the tools (ignored while editing text or
 *   typing in an input); Escape reverts to Select. The Select tool is
 *   always available; the creation tools only while the board is editable
 *   (board.readonly: a read-only board always uses Select and an active
 *   creation tool reverts when the board becomes uneditable).
 * - `toolCreated(id)` (tools.return_to_select): selects the freshly created
 *   object and switches back to Select so it can be adjusted immediately.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SHAPE_KINDS,
  type ShapeKind,
} from '../../shared/config';

/** Every tool id the product knows (stories 9-12 fill this in). */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Single-letter shortcuts (tools.active_tool): key -> tool id. */
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

/** The tools a user can actually activate in story 10. */
const IMPLEMENTED_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  'text',
  'shape',
  'connector',
]);

export interface ActiveToolOptions {
  /** The board is editable (not load_failed). Default true. */
  canEdit?: boolean;
  /** toolCreated selects the new object here. */
  selectObject?: (id: string) => void;
  /** The momentary 'sticky' tool (N / toolbar button): create a sticky at
   *  the view centre (story 9 behaviour). */
  onCreateSticky?: () => void;
}

export interface ActiveTool {
  /** The active tool id ('select' by default). */
  tool: ToolId;
  /** The kind the Shape tool draws (the Toolbar's kind buttons). */
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** tools.return_to_select: select `id` and switch to Select. */
  toolCreated(id: string): void;
}

export function useActiveTool(options: ActiveToolOptions = {}): ActiveTool {
  const { canEdit = true, selectObject, onCreateSticky } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // Options are read through a ref so the window listener never re-binds.
  const optionsRef = useRef({ canEdit, selectObject, onCreateSticky });
  optionsRef.current = { canEdit, selectObject, onCreateSticky };
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const setTool = useCallback((t: ToolId): void => {
    const { canEdit: editable } = optionsRef.current;
    if (t !== 'select' && (!editable || !IMPLEMENTED_TOOLS.has(t))) {
      setToolState('select');
      return;
    }
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind): void => {
    if ((SHAPE_KINDS as readonly string[]).includes(k)) {
      setShapeKindState(k);
    }
  }, []);

  const toolCreated = useCallback((id: string): void => {
    optionsRef.current.selectObject?.(id);
    setToolState('select');
  }, []);

  // A board that becomes uneditable always uses Select.
  useEffect(() => {
    if (!canEdit && tool !== 'select') {
      setToolState('select');
    }
  }, [canEdit, tool]);

  // Shortcuts + Escape (tools.active_tool): plain single letters only —
  // never with modifiers, never while editing text or typing in an input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.isContentEditable)
      ) {
        return; // focus is in a text input: the character belongs there
      }
      if (e.key === 'Escape') {
        if (toolRef.current !== 'select') {
          setToolState('select');
        }
        return;
      }
      const id = TOOL_SHORTCUTS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (id === undefined) {
        return; // unknown shortcut: ignored
      }
      if (id === 'sticky') {
        // The momentary tool: N creates a sticky at the view centre (the
        // story 9 behaviour) and never stays active.
        if (optionsRef.current.canEdit) {
          optionsRef.current.onCreateSticky?.();
        }
        return;
      }
      if (id === 'select') {
        setToolState('select');
        return;
      }
      // Creation tools: only while the board is editable.
      if (optionsRef.current.canEdit && IMPLEMENTED_TOOLS.has(id)) {
        setToolState(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
