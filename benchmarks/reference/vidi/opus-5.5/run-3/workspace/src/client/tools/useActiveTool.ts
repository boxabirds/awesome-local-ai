import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

/** Every board tool across stories 9-12 and 16. */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts (without modifiers). */
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

/**
 * The tools this build offers as modes. The sticky note is an action (N and the toolbar button create a note in the
 * centre, handled by useBoardKeys); the Image tool (story 12) is an action too: it opens the file picker and the
 * active tool stays as it was (Select); comment belongs to a story that is not part of this build. The Pen
 * (story 11) stays active after each stroke until another tool is chosen or Escape is pressed.
 */
export const MODE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector', 'pen']);

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A tool created `id`: select it and go back to the Select tool (tools.return_to_select). */
  toolCreated(id: string): void;
}

/**
 * This client's active tool (never persisted) and the Shape tool's kind. Window shortcuts: V, T, S, L, P choose a
 * tool; I opens the image file picker (when `onImage` is given) and returns to Select; Escape returns from any other tool to Select without creating anything. Shortcuts are ignored while typing
 * in a text field or editing an object's text, and unknown letters are ignored.
 *
 * Tools other than Select need an editable board: they cannot be chosen while the board cannot be edited, and an
 * active one reverts to Select when editing becomes impossible.
 */
export function useActiveTool(
  opts: {
    canEdit?: boolean;
    /** Selects a just-created object (called by `toolCreated`). */
    onSelectCreated?(id: string): void;
    /** True while an object's text is being edited: shortcuts are off. */
    isEditing?: boolean;
    /** The Image tool was chosen (I): open the file picker (story 12). */
    onImage?(): void;
  } = {},
): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(SHAPE_KINDS[0]);
  const latest = useRef({ ...opts, canEdit, tool });
  latest.current = { ...opts, canEdit, tool: canEdit ? tool : 'select' };

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback((t: ToolId) => {
    if (!MODE_TOOLS.has(t)) return;
    if (t !== 'select' && !latest.current.canEdit) return;
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    if ((SHAPE_KINDS as readonly string[]).includes(k)) setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    latest.current.onSelectCreated?.(id);
    setToolState('select');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { isEditing, canEdit: editable, tool: current } = latest.current;
      if (isEditing || isTextField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') {
        if (current !== 'select') setToolState('select');
        return;
      }
      if (e.shiftKey || e.key.length !== 1) return;
      const t = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (t === 'image' && latest.current.onImage) {
        if (!editable) return;
        e.preventDefault();
        setToolState('select');
        latest.current.onImage();
        return;
      }
      if (!t || !MODE_TOOLS.has(t)) return;
      if (t !== 'select' && !editable) return;
      e.preventDefault();
      setToolState(t);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
