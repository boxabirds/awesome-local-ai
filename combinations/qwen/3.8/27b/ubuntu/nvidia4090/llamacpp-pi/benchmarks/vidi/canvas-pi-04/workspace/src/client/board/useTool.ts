// Story 9: the per-client tool mode (anchor: text.tool_ui), extended in
// story 10 to `select | text | shape | connector` (tools.active).
//
// A per-client UI state (not persisted). While a tool is active:
//  - `text`: text cursor; a click creates text there (BoardViewport);
//  - `shape`: crosshair cursor; a click/drag draws a shape of `shapeKind`
//    (ShapeTool); Shift during the drag forces a square;
//  - `connector`: crosshair cursor; a drag draws an arrow between its
//    endpoints (ConnectorTool).
// In all drawing tools the pressed toolbar button shows as pressed, and
// empty-space presses neither pan nor marquee (BoardViewport).
//
// `canEdit` false (load_failed) disables the tools: S/L/T are ignored, the
// buttons are disabled, and an active tool reverts to Select.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/config';

export type Tool = 'select' | 'text' | 'shape' | 'connector' | 'pen';

export interface ToolApi {
  tool: Tool;
  /** The kind drawn while the shape tool is active (shape.button). */
  shapeKind: ShapeKind;
  setTool(tool: Tool): void;
  setShapeKind(kind: ShapeKind): void;
  /**
   * A drawing tool finished successfully: select the created object and
   * switch back to Select (tools.auto_return). Called with the new id.
   */
  toolCreated(id: string): void;
}

export interface ToolOptions {
  /** Select the object a drawing tool just created. */
  onSelectCreated?: ((id: string) => void) | null;
}

export function useTool(canEdit: boolean, opts: ToolOptions = {}): ToolApi {
  const [tool, setToolState] = useState<Tool>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>('rect');
  const onSelectCreatedRef = useRef(opts.onSelectCreated);
  onSelectCreatedRef.current = opts.onSelectCreated;

  // A board that loses editability (load_failed) reverts to Select; the
  // tools are unavailable while read-only.
  useEffect(() => {
    if (!canEdit && tool !== 'select') setToolState('select');
  }, [canEdit, tool]);

  const setTool = useCallback(
    (next: Tool): void => {
      // Drawing tools are ignored read-only.
      if (next !== 'select' && !canEdit) return;
      setToolState(next);
    },
    [canEdit],
  );

  const setShapeKind = useCallback((kind: ShapeKind): void => {
    setShapeKindState(kind);
  }, []);

  const toolCreated = useCallback((id: string): void => {
    if (id === '') return;
    onSelectCreatedRef.current?.(id);
    setToolState('select');
  }, []);

  return { tool, shapeKind, setTool, setShapeKind, toolCreated };
}
