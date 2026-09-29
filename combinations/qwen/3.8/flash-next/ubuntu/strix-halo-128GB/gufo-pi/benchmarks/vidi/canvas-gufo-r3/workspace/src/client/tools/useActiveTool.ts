import { useCallback, useEffect, useState } from 'react';
import { SHAPE_KINDS, ShapeKind, DEFAULT_SHAPE_KIND } from '@shared/config';

export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Lowercase key -> tool, exactly as specified by the story. */
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

export interface UseActiveToolOptions {
  /** Tool state is forced back to 'select' when false. */
  canEdit?: boolean;
  /** Called with the created object's id so the host can select it (toolCreated). */
  onSelect?: (id: string) => void;
}

export interface UseActiveToolResult {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(tool: ToolId): void;
  setShapeKind(kind: ShapeKind): void;
  /** Select the just-created object and return to Select (fires onSelect). */
  toolCreated(id: string): void;
}

function isToolId(value: ToolId): boolean {
  return (
    value === 'select' ||
    value === 'sticky' ||
    value === 'text' ||
    value === 'shape' ||
    value === 'connector' ||
    value === 'pen' ||
    value === 'image' ||
    value === 'comment'
  );
}

/**
 * Tool state for the toolbar and tools: tool + shape kind, the TOOL_SHORTCUTS
 * keydown listener, and return-to-Select (Escape while a creation tool is active,
 * or after any tool creates). Read-only boards ignore tool keys.
 */
export function useActiveTool(opts: UseActiveToolOptions = {}): UseActiveToolResult {
  const { canEdit = true, onSelect } = opts;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(DEFAULT_SHAPE_KIND);

  const setTool = useCallback(
    (next: ToolId) => {
      if (!canEdit) {
        setToolState('select');
        return;
      }
      if (!isToolId(next)) return;
      setToolState(next);
    },
    [canEdit],
  );

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    if ((SHAPE_KINDS as readonly string[]).includes(kind)) setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      if (onSelect) onSelect(id);
      setToolState('select');
    },
    [onSelect],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!canEdit) return;
      // Escape returns from a creation tool to Select (pen stays active until Escape)
      if (e.key === 'Escape') {
        setToolState((cur) => (cur === 'shape' || cur === 'connector' || cur === 'text' || cur === 'pen' ? 'select' : cur));
        return;
      }
      const key = e.key.toLowerCase();
      const target = TOOL_SHORTCUTS[key];
      // Only tools actually implemented as overlays/selection act on their key.
      if (target === 'select' || target === 'text' || target === 'shape' || target === 'connector' || target === 'pen') {
        e.preventDefault();
        setToolState(target);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canEdit]);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
