/**
 * Active tool hook: manages the active tool, shape kind, and return-to-select logic.
 *
 * Stories 10-12 extend the Tool type. Escape and V return to Select;
 * S activates Shape, L activates Connector. When canEdit becomes false,
 * an active tool reverts to Select.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ShapeKind } from '../../shared/config';

export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

/** Keyboard shortcut mapping for tools. */
export const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  n: 'select', // handled separately for create sticky
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
};

export interface UseToolResult {
  tool: Tool;
  shapeKind: ShapeKind;
  setTool(t: Tool): void;
  setShapeKind(k: ShapeKind): void;
  /** Called after a shape or connector is created: selects the id and returns to select. */
  toolCreated(id: string): void;
}

export interface UseToolOpts {
  canEdit: boolean;
  /** Callback to select an object by id (from useSelection). */
  onSelect?(id: string): void;
}

/**
 * Active tool state. The hook manages a simple state machine:
 * - select (default)
 * - text (activated by T key or Text button)
 * - shape (activated by S key or Shape button)
 * - connector (activated by L key or Connector button)
 *
 * When canEdit becomes false, an active tool reverts to Select.
 */
export function useTool(opts: UseToolOpts): UseToolResult;
export function useTool(canEdit: boolean): { tool: Tool; setTool(t: Tool): void };
export function useTool(arg: UseToolOpts | boolean): UseToolResult | { tool: Tool; setTool(t: Tool): void } {
  const canEdit = typeof arg === 'boolean' ? arg : arg.canEdit;
  const onSelect = typeof arg === 'boolean' ? undefined : arg.onSelect;

  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  const setTool = useCallback((t: Tool) => {
    setToolState(t);
  }, []);

  // If canEdit becomes false while a non-select tool is active, revert to Select
  useEffect(() => {
    if (!canEdit) {
      setToolState('select');
    }
  }, [canEdit]);

  const toolCreated = useCallback((id: string) => {
    setToolState('select');
    if (onSelect) onSelect(id);
  }, [onSelect]);

  if (typeof arg === 'boolean') {
    return { tool, setTool };
  }

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
