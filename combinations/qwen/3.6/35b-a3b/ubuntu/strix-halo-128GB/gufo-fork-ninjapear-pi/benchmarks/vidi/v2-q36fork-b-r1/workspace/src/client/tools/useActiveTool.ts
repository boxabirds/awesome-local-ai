import { useState, useCallback, useEffect } from 'react';
import { SHAPE_KINDS } from '@/shared/config';
import type { ShapeKind } from '@/shared/objects/shape';

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

interface UseActiveToolOptions {
  canEdit?: boolean;
}

interface UseActiveToolReturn {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Called when a shape or connector is created — selects the new object and returns to Select. */
  toolCreated(id: string): void;
}

/**
 * Active tool hook with shortcuts and return-to-Select after creation.
 * Creates here if no earlier story (9–12) has added it; otherwise story 10 only adds
 * `shape` and `connector` entries and `shapeKind`.
 */
export function useActiveTool(options: UseActiveToolOptions = {}): UseActiveToolReturn {
  const { canEdit } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // Revert to select when canEdit turns false
  useEffect(() => {
    if (canEdit === false && (tool === 'text' || tool === 'sticky')) {
      setToolState('select');
    }
  }, [canEdit, tool]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      // Ignore contenteditable inside board viewport
      if (tag === 'div' && document.activeElement?.getAttribute('contenteditable') === 'true') {
        const boardRoot = document.querySelector('[data-testid="board-viewport"]');
        if (boardRoot && !boardRoot.contains(document.activeElement)) {
          return;
        }
      }

      if (!TOOL_SHORTCUTS[e.key.toLowerCase()]) return;

      // If tool is already correct, do nothing more
      e.preventDefault();

      if (e.key === 'Escape') {
        // Escape while Shape or Connector active → switch to Select, create nothing
        setToolState('select');
        return;
      }

      const target = TOOL_SHORTCUTS[e.key.toLowerCase()]!;
      if (target !== 'select' && canEdit === false) return;
      setToolState(target);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit]);

  const setTool = useCallback((t: ToolId) => {
    if (canEdit === false && (t === 'text' || t === 'sticky')) return;
    setToolState(t);
  }, [canEdit]);

  const setShapeKind = useCallback((k: ShapeKind) => {
    setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    // This would normally call useSelection click/setMany + setTool(select),
    // but since this hook doesn't have access to selection,
    // the caller passes this callback which handles it externally.
    // The hook just records the "switch to Select" part.
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
