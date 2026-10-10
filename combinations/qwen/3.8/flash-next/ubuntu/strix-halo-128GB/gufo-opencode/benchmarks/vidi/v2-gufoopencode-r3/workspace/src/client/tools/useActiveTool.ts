import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import type { SelectionController } from '../board/useSelection';

// All toolbar tool ids. 'sticky' stays a one-shot toolbar action (story 2)
// and 'image' / 'comment' arrive with later stories; only the
// pointer-gesture tools below can become active on the board.
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

// v select, n sticky, t text, s shape, l connector, p pen, i image, c comment
export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment'
};

const ACTIVATABLE: ReadonlySet<ToolId> = new Set<ToolId>([
  'select',
  'text',
  'shape',
  'connector',
  'pen'
]);

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

export interface UseActiveToolOptions {
  // False while the board cannot be mutated (load_failed): no tool but
  // Select can be active (story 9 TC-15 extends to the new tools).
  canEdit?: boolean;
  // Passed through so toolCreated() can make the new object the selection.
  selection?: SelectionController;
  // Story 12: 'image' is not a persistent tool — I opens the file picker
  // and the board stays on Select.
  onImagePick?(): void;
}

export interface UseActiveToolResult {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
}

// Owns the active board tool, its single-letter shortcuts and the
// return-to-Select rule: after a tool creates an object (toolCreated) or on
// Escape, Select is active again and nothing pending is created.
export function useActiveTool(options: UseActiveToolOptions = {}): UseActiveToolResult {
  const { canEdit = true, selection, onImagePick } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  // Image opens the picker without ever becoming the active tool; keep the
  // latest callback without re-binding the key listener.
  const imagePickRef = useRef(onImagePick);
  imagePickRef.current = onImagePick;

  // A board that stops being editable cannot keep a creation tool active.
  useEffect(() => {
    if (!canEdit) setToolState((prev) => (prev === 'select' ? prev : 'select'));
  }, [canEdit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        setToolState((prev) => (prev === 'select' ? prev : 'select'));
        return;
      }
      if (e.key.length !== 1) return;
      const id = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (id === undefined) return;
      if (!canEdit) return;
      if (id === 'image') {
        // Story 12: I opens the file picker; Select stays active.
        imagePickRef.current?.();
        return;
      }
      if (!ACTIVATABLE.has(id)) return; // 'n' is story 2's note creation
      setToolState((prev) => (prev === id ? prev : id));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit]);

  const setTool = useCallback((t: ToolId) => {
    setToolState(ACTIVATABLE.has(t) ? t : 'select');
  }, []);

  // tools.return_to_select: the new object is the only selection and the
  // tool returns to Select. selectNew bypasses the presence check of
  // 'click' because the doc observer has not run yet this tick.
  const toolCreated = useCallback(
    (id: string) => {
      selection?.selectNew(id);
      setToolState((prev) => (prev === 'select' ? prev : 'select'));
    },
    [selection]
  );

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
