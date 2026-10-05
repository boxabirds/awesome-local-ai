import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/objects/shape';

/** Board tools (stories 9–12). */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter keyboard shortcuts for each tool. */
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
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Select the created object and switch to the select tool. */
  toolCreated(id: string): void;
}

export interface UseActiveToolOptions {
  canEdit: boolean;
  /** Selects an object by id (from useSelection). */
  selectObject(id: string): void;
}

/**
 * Active tool state (tools.active_tool). Manages the tool id, shape kind,
 * keyboard shortcuts (S, L, V, Escape), and return-to-select after creation.
 */
export function useActiveTool(opts: UseActiveToolOptions): ActiveToolState {
  const { canEdit, selectObject } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const selectObjectRef = useRef(selectObject);
  selectObjectRef.current = selectObject;

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const toolCreated = useCallback((id: string) => {
    selectObjectRef.current(id);
    setToolState('select');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const k = e.key.toLowerCase();
      if (k === 's' && canEditRef.current) {
        e.preventDefault();
        setToolState('shape');
        return;
      }
      if (k === 'l' && canEditRef.current) {
        e.preventDefault();
        setToolState('connector');
        return;
      }
      if (k === 'v') {
        e.preventDefault();
        setToolState('select');
        return;
      }
      if (e.key === 'Escape') {
        setToolState('select');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
