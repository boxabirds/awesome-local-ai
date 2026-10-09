import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';
import type { SelectionApi } from '../board/useSelection';

/**
 * Story 10 (tool contract): the active tool, per client.
 *
 * 'select' is the default. 'text' and 'shape' keep their story 9 / story 10
 * behaviour; 'connector' arms the connector tool; 'pen' (story 11) draws
 * freehand strokes. 'image' / 'comment' are reserved for later stories —
 * their shortcuts do nothing here.
 *
 * The tool is client state only — it is never persisted in the shared doc,
 * so each client keeps its own tool. When the board becomes non-editable
 * (load failed) an armed tool reverts to Select.
 *
 * Keyboard shortcuts (window keydown, ignored while editing text or focus is
 * in an input/textarea/content element): v → Select, n → new sticky at the
 * view centre (story 9 behaviour), t → Text, s → Shape, l → Connector,
 * p → Pen.
 * Escape (cancel an in-progress draw / back to Select) stays in
 * useBoardKeys, which owns the other board keys.
 */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** The single-key shortcut for every tool (lowercase keys). */
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

/** Tools that can actually be armed in this story. */
const ARMABLE: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

export interface ActiveToolApi {
  readonly tool: ToolId;
  /** The kind the Shape tool draws next (the Shape menu's selection). */
  readonly shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /**
   * Called by a tool right after it created an object: the object is selected
   * (once it is present in the snapshot) and the tool returns to Select.
   */
  toolCreated(id: string): void;
}

export function useActiveTool(opts: {
  canEdit: boolean;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  onNewSticky(): void;
  /**
   * Story 12: the I shortcut (and the Image toolbar button) open the file
   * picker directly — 'image' is an action, not an armable tool; after the
   * picker the Select tool remains active.
   */
  onImagePicker?(): void;
}): ActiveToolApi {
  const { canEdit, selection, snapshot, onNewSticky } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(SHAPE_KINDS[0]);
  const setTool = useCallback((t: ToolId) => setToolState(t), []);
  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);

  // A non-select tool reverts when the board becomes non-editable.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  // toolCreated: select the new id once present, then clear the pending mark.
  const pendingRef = useRef<string | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const toolCreated = useCallback((id: string) => {
    pendingRef.current = id;
    setToolState('select');
  }, []);
  useEffect(() => {
    const id = pendingRef.current;
    if (id === null) return;
    if (snapshot.some((o) => o.id === id)) {
      selectionRef.current.click(id);
      pendingRef.current = null;
    }
  }, [snapshot]);

  // Tool shortcuts (story 10): unmodified single keys only, ignored while
  // editing text or focus is in a field — the same guards as useBoardKeys.
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const onNewStickyRef = useRef(onNewSticky);
  onNewStickyRef.current = onNewSticky;
  const onImagePickerRef = useRef(opts.onImagePicker);
  onImagePickerRef.current = opts.onImagePicker;
  const editingRef = useRef<string | null>(null);
  editingRef.current = selection.editingId;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (editingRef.current !== null) return; // text editing owns the keyboard
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }
      const dest = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (dest === undefined) return;
      if (dest === 'sticky') {
        // N keeps its story 9 behaviour: a new sticky at the view centre.
        if (!canEditRef.current) return;
        e.preventDefault();
        onNewStickyRef.current();
        return;
      }
      if (dest === 'image') {
        // Story 12: I opens the file picker (then Select stays active).
        if (!canEditRef.current) return;
        e.preventDefault();
        onImagePickerRef.current?.();
        return;
      }
      if (!ARMABLE.has(dest)) return; // comment: later stories
      if (!canEditRef.current && dest !== 'select') return;
      e.preventDefault();
      setToolState(dest);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
