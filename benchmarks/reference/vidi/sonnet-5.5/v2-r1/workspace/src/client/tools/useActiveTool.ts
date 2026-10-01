import { useCallback, useState } from 'react';
import type { ShapeKind } from '../../shared/config';
import { useTool } from '../board/useTool';

export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcuts; later stories' tools are listed so the convention is in one place. */
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
 * Active tool, the kind the Shape tool draws, and "created something, back to Select".
 * `onSelect` makes the new id the only selected object (the board passes its selection).
 */
export function useActiveTool(opts: { canEdit?: boolean; onSelect?(id: string): void } = {}): {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  toolCreated(id: string): void;
} {
  const { tool, setTool } = useTool(opts.canEdit ?? true);
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const { onSelect } = opts;
  const setShapeKind = useCallback((k: ShapeKind) => setShapeKindState(k), []);
  const toolCreated = useCallback(
    (id: string) => {
      onSelect?.(id);
      setTool('select');
    },
    [onSelect, setTool],
  );
  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
