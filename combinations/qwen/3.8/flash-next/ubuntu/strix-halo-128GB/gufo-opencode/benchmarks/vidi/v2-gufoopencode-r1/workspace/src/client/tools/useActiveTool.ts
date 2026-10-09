import { useCallback, useEffect, useRef, useState } from 'react';
import { SHAPE_KINDS, type ShapeKind } from '../../shared/config';
import type { SelectionApi } from '../board/useSelection';
import { useTool } from '../board/useTool';
import type { Tool } from '../board/useTool';

export type { Tool } from '../board/useTool';

// Letter shortcuts to the pointer tool they select. Only the tools that exist
// in a given story change state; the others are documented for later stories.
export const TOOL_SHORTCUTS: Readonly<Record<string, Tool>> = {
  v: 'select',
  t: 'text',
  s: 'shape',
  l: 'connector'
};

export interface ActiveToolApi {
  tool: Tool;
  setTool(t: Tool): void;
  shapeKind: ShapeKind;
  setShapeKind(kind: ShapeKind): void;
  // Select the object a tool just created (non-additively) and fall back to
  // the Select tool, so one creation does not arm a second.
  toolCreated(id: string): void;
}

// Owns the active tool, the pending shape kind, the tool letter shortcuts and
// the return-to-Select-after-create behaviour. Sticky creation ('n') stays in
// the viewport because it creates immediately rather than arming a tool.
export function useActiveTool(args: {
  canEdit: boolean;
  selection?: SelectionApi;
}): ActiveToolApi {
  const { tool, setTool } = useTool(args.canEdit);
  const [shapeKind, setShapeKind] = useState<ShapeKind>(SHAPE_KINDS[0] ?? 'rect');
  const selectionRef = useRef(args.selection);
  selectionRef.current = args.selection;

  const toolCreated = useCallback(
    (id: string): void => {
      selectionRef.current?.setMany([id], false);
      setTool('select');
    },
    [setTool]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (selectionRef.current !== undefined && selectionRef.current.editingId !== null) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true)
      ) {
        return;
      }
      if (event.key === 'Escape') {
        setTool('select');
        return;
      }
      const mapped = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (mapped === undefined) return;
      if (mapped !== 'select' && !args.canEdit) return;
      event.preventDefault();
      setTool(mapped);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool, args.canEdit]);

  return { tool, setTool, shapeKind, setShapeKind, toolCreated };
}
