import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShapeKind } from '../../shared/board-model';
import { SHAPE_KINDS } from '../../shared/config';

/**
 * Every tool id of the cross-story convention. Only `select`, `text` (story 9), `shape` and
 * `connector` (story 10) are modes in this build; `sticky` is an action (a note at the view
 * centre) and pen, image and comment belong to stories that are not part of it.
 */
export type ToolId = 'select' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'image' | 'comment';

/** Single-letter shortcut → tool (v select, n sticky, t text, s shape, l connector, p pen, i image, c comment). */
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

/** Tools that are modes the board can be in (the rest are ignored by setTool). */
export const MODE_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(['select', 'text', 'shape', 'connector']);

export const SELECT_TOOL_LABEL = 'Select (V)';
export const TEXT_TOOL_LABEL = 'Text (T)';
export const SHAPE_TOOL_LABEL = 'Shape (S)';
export const CONNECTOR_TOOL_LABEL = 'Connector (L)';
/** Shape menu entries (visible text and accessible name). */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ActiveToolOptions {
  /** False while the board cannot be edited: only Select can be active. Default true. */
  canEdit?: boolean;
  /** Selects a just-created object (toolCreated). */
  onSelect?(id: string): void;
}

export interface ActiveTool {
  tool: ToolId;
  shapeKind: ShapeKind;
  setTool(t: ToolId): void;
  setShapeKind(k: ShapeKind): void;
  /** A shape or arrow was created: select it and return to Select (tools.return_to_select). */
  toolCreated(id: string): void;
}

/**
 * This viewer's active tool and chosen shape kind (never persisted or shared). Creation tools
 * can only be chosen while the board can be edited, and an active one reverts to Select as soon
 * as it cannot. Keyboard shortcuts (TOOL_SHORTCUTS, Escape) are wired in the board's key handler
 * (useBoardKeys), which already owns the "not while typing" rules.
 */
export function useActiveTool(opts: ActiveToolOptions = {}): ActiveTool {
  const canEdit = opts.canEdit ?? true;
  const [tool, setToolState] = useState<ToolId>('select');
  const [shapeKind, setShapeKindState] = useState<ShapeKind>(SHAPE_KINDS[0]);
  const optsRef = useRef({ canEdit, onSelect: opts.onSelect });
  optsRef.current = { canEdit, onSelect: opts.onSelect };

  useEffect(() => {
    if (!canEdit) setToolState('select');
  }, [canEdit]);

  const setTool = useCallback((t: ToolId) => {
    if (!MODE_TOOLS.has(t)) return;
    if (t !== 'select' && !optsRef.current.canEdit) return;
    setToolState(t);
  }, []);

  const setShapeKind = useCallback((k: ShapeKind) => {
    if ((SHAPE_KINDS as readonly string[]).includes(k)) setShapeKindState(k);
  }, []);

  const toolCreated = useCallback((id: string) => {
    optsRef.current.onSelect?.(id);
    setToolState('select');
  }, []);

  return { tool: canEdit ? tool : 'select', shapeKind, setTool, setShapeKind, toolCreated };
}
