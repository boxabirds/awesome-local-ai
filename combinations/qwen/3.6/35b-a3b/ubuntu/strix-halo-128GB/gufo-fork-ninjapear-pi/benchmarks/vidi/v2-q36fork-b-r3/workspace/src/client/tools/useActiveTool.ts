import { useState, useCallback, useEffect } from 'react';
import type { ShapeKind } from '@shared/objects/shape';
import { SHAPE_KINDS } from '@shared/config';

/** Tool identifiers supported across stories 1-17. */
export type ToolId =
  | 'select'
  | 'sticky'
  | 'text'
  | 'shape'
  | 'connector'
  | 'pen'
  | 'image'
  | 'comment';

/** Maps single-letter keycodes to tool identifiers. */
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

interface UseActiveToolReturn {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** Called when a shape or connector is created — selects it and returns to Select. */
  toolCreated(id: string): void;
}

/**
 * Active tool hook shared by stories 9–12.
 * Provides keyboard shortcuts, shape kind state, and return-to-select on creation.
 */
export function useActiveTool(selection?: { click?(id: string): void }, onCreateSticky?: () => void): UseActiveToolReturn {
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in input/textarea/select/contenteditable
      const tag = (e.target as HTMLElement).tagName;
      const isInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (e.target as HTMLElement).getAttribute('contenteditable') === 'true';
      if (isInput) return;

      // Escape → revert to Select (for Shape and Connector tools)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (tool === 'shape' || tool === 'connector') {
          setToolState('select');
        } else {
          selection?.click && selection.click('__noop__') ? null : null; // just clear via selection if available
          setToolState('select');
        }
        return;
      }

      const lowerKey = e.key.toLowerCase();
      const mappedTool = TOOL_SHORTCUTS[lowerKey];
      if (!mappedTool) return;

      // Single letter shortcuts (v, n, t, s, l, p, i, c)
      if (Object.values(TOOL_SHORTCUTS).includes(mappedTool)) {
        e.preventDefault();
        if (mappedTool === 'shape') {
          // Cycle shape kind with repeated S presses or select from menu
          setToolState('shape');
        } else if (mappedTool === 'connector') {
          setToolState('connector');
        } else if (mappedTool === 'select') {
          setToolState('select');
          selection?.click && selection.click('__dummy__') ? null : null;
        } else {
          setToolState(mappedTool);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, selection]);

  const setTool = useCallback((t: ToolId) => {
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    if (SHAPE_KINDS.includes(k)) {
      setShapeKindState(k);
    }
  }, []);

  const toolCreated = useCallback((id: string) => {
    selection?.click?.(id);
    setToolState('select');
  }, [selection]);

  return {
    tool,
    shapeKind,
    setTool,
    setShapeKind,
    toolCreated,
  };
}
