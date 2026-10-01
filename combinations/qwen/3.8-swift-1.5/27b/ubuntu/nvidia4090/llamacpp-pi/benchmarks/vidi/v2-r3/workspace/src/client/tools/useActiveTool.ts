import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

/** The board's active tool id (story 10 extends with shape and connector). */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts for tools. */
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

export interface ActiveToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool: (t: ToolId) => void;
  setShapeKind: (k: ShapeKind) => void;
  /** Called after a shape/connector is created: selects the id and switches to Select. */
  toolCreated: (id: string) => void;
}

interface UseActiveToolOpts {
  /** Whether the board is editable (gates non-select tools). */
  canEdit: boolean;
  /** Select the given object id (from useSelection). */
  select: (id: string) => void;
}

/**
 * Story 10 (tools.active_tool): the active tool with shortcuts and
 * return-to-Select behaviour.
 *
 * - Single-letter shortcuts (S, L, V, etc.) switch tools; ignored while typing.
 * - Escape while Shape or Connector is active → Select (creates nothing).
 * - `toolCreated(id)` selects the new object and switches to Select.
 */
export function useActiveTool(opts: UseActiveToolOpts): ActiveToolState {
  const { canEdit, select } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const selectRef = useRef(select);
  selectRef.current = select;

  const setTool = useCallback((t: ToolId) => {
    if (t !== 'select' && !canEditRef.current) return;
    setToolState(t);
  }, []);

  // Fall back to select when the board becomes read-only.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore while typing in an editor or input
      const target = e.target as HTMLElement | null;
      if (target) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable
        ) return;
      }

      const mod = e.ctrlKey || e.metaKey || e.altKey;
      if (mod) return;

      // Escape: return to Select (creates nothing)
      if (e.key === 'Escape') {
        setToolState('select');
        return;
      }

      // Single-letter shortcuts
      const key = e.key.toLowerCase();
      const mapped = TOOL_SHORTCUTS[key];
      if (mapped) {
        if (mapped !== 'select' && !canEditRef.current) return;
        setToolState(mapped);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toolCreated = useCallback((id: string) => {
    selectRef.current(id);
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
