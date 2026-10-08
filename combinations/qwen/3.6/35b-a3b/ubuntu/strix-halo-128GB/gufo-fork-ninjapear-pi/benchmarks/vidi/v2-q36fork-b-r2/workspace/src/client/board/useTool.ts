import * as React from 'react';
import { SHAPE_KINDS } from '../../shared/config';
import type { ShapeKind } from '../../shared/objects/shape';

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

// Legacy alias for existing code expecting just 'select' | 'text'
export type Tool = 'select' | 'text';

interface UseToolState {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
  // Optional undo boundary function called after tool creation
  onBoundary?(): void;
}

/**
 * Active tool management hook.
 * Manages current tool id, shape kind selection for the shape tool,
 * keyboard shortcuts, and return-to-select after creation.
 */
export function useActiveTool(
  selection?: { click(id: string): void; clear(): void },
  canEdit?: boolean,
  onBoundary?: () => void,
): UseToolState {
  const [tool, setToolInternal] = React.useState<ToolId>('select');
  const [shapeKind, setShapeKind] = React.useState<ShapeKind>('rect');

  // Handle shortcut key → tool mapping
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea or contenteditable
      const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
      const contentEditable = (e.target as HTMLElement)?.getAttribute('contenteditable');
      if (tag === 'INPUT' || tag === 'TEXTAREA' || contentEditable === 'true') {
        return;
      }

      // Escape while in shape, connector or pen → select, create nothing
      if (e.key === 'Escape') {
        if (tool === 'shape' || tool === 'connector' || tool === 'pen') {
          setToolInternal('select');
          e.preventDefault();
        }
        return;
      }

      // Single letter shortcuts
      const keyMap = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (keyMap) {
        e.preventDefault();
        if (canEdit !== false) {
          setToolInternal(keyMap);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tool, canEdit]);

  const setTool = React.useCallback((t: ToolId) => {
    setToolInternal(t);
  }, []);

  const setShapeKindFn = React.useCallback((k: ShapeKind) => {
    setShapeKind(k);
  }, []);

  const toolCreated = React.useCallback((id: string) => {
    // Select the newly created object and switch back to select tool
    if (selection) {
      selection.click(id);
    }
    setToolInternal('select');
    // End undo capture
    onBoundary?.();
  }, [selection, onBoundary]);

  return { tool, shapeKind, setTool, setShapeKind: setShapeKindFn, toolCreated };
}

// Legacy wrapper for existing usage
export function useTool(canEdit: boolean): {
  tool: Tool;
  setTool(t: Tool): void;
} {
  const { tool, setTool: setActiveTool } = useActiveTool(undefined, canEdit);

  React.useEffect(() => {
    if (!canEdit && (tool === 'text' || tool === 'sticky')) {
      setActiveTool('select');
    }
  }, [canEdit, tool, setActiveTool]);

  // Map legacy tool type to full tool id
  const mappedTool = (tool === 'select' || tool === 'text') ? tool : 'select';
  const mappedSetTool = (t: Tool) => setActiveTool(t);

  return { tool: mappedTool, setTool: mappedSetTool };
}
