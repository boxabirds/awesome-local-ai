/**
 * useActiveTool: active tool state, shape kind, shortcuts (S, L, V, Escape),
 * and return-to-select after creating.
 *
 * This extends useTool (story 9) with shape and connector tools.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

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

export interface UseActiveToolResult {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Select the new id and switch to Select (return-to-select). */
  toolCreated(id: string): void;
}

/** True when focus is in a text-editing element. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface UseActiveToolOptions {
  canEdit: boolean;
  /** Callback to select a single object id. */
  onSelect(id: string): void;
}

export function useActiveTool(opts: UseActiveToolOptions): UseActiveToolResult {
  const { canEdit, onSelect } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const setTool = useCallback(
    (t: ToolId) => {
      if (!canEditRef.current && t !== 'select') return;
      setToolState(t);
    },
    [],
  );

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      onSelect(id);
      setToolState('select');
    },
    [onSelect],
  );

  // Window keydown for shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isTextEntry(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Escape: switch to select if in shape or connector
      if (event.key === 'Escape') {
        const cur = toolRef.current;
        if (cur === 'shape' || cur === 'connector') {
          setToolState('select');
        }
        return;
      }

      const key = event.key.toLowerCase();
      const mapped = TOOL_SHORTCUTS[key];
      if (mapped) {
        if (mapped !== 'select' && !canEditRef.current) return;
        setToolState(mapped);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
